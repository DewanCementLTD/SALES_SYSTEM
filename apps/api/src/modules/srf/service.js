// SRF commands (BUSINESS_RULES §3, TASKS P2-01). DRAFT → SUBMITTED (draft OC created, BR-SRF-05)
// → CONVERTED (when its OC is confirmed, P2-03); DRAFT/SUBMITTED → CANCELLED while the OC is not
// confirmed (BR-SRF-06). One transaction per command (CLAUDE.md rule 6).
import {
  MASTERS,
  SRF_CANCELLABLE_OC_STATES,
  canTrade,
  checkTransition,
  contractValidTo,
  fiscalYearOf,
  srfProblems,
} from '@dcl/shared';
import { Errors } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import * as customers from '../customers/repo.js';
import { productCodeExists, refExists } from '../masters/repo.js';
import { nextNumber } from '../numbering/service.js';
import { OC_STATUS_SQL, cancelOcRow, createDraftOc } from '../oc/builder.js';
import { SettingsReader } from '../settings/service.js';
import * as repo from './repo.js';

const toDate = (iso) => new Date(`${iso}T00:00:00+05:00`);

/** SRF with its schedule. */
export async function getSrf(tx, brnch, srfNo, opts) {
  const srf = await repo.get(tx, brnch, srfNo, opts);
  if (!srf) throw Errors.notFound(`SRF ${srfNo}`);
  return { ...srf, schedule: await repo.schedule(tx, brnch, srfNo) };
}

/** Checks against the database (customer can trade, product/destination/masters exist). */
async function checkRefs(tx, brnch, body) {
  const c = await customers.getCustomer(tx, brnch, body.customerCode);
  if (!c) throw Errors.notFound(`Customer ${body.customerCode}`);
  const t = canTrade(c);
  if (!t.ok)
    throw Errors.rule('BR-CUS-02', `${t.reason}: an SRF needs an approved, active customer`);
  const problems = [];
  if (!(await productCodeExists(tx, brnch, body.productCode)))
    problems.push({ path: 'productCode', message: 'Unknown product' });
  const geo = await tx.one('SELECT ACTIVE FROM GEO_HIERARCHY WHERE BRNCH = :b AND GEO_CODE = :g', {
    b: brnch,
    g: body.destGeoCode,
  });
  if (!geo || geo.ACTIVE === 'N')
    problems.push({ path: 'destGeoCode', message: 'Unknown or inactive destination' });
  if (!(await refExists(tx, MASTERS['transport-modes'], brnch, body.modeOfTransport)))
    problems.push({ path: 'modeOfTransport', message: 'Unknown mode of transport' });
  if (body.bagCode !== null && body.bagCode !== undefined) {
    if (!(await refExists(tx, MASTERS.bags, brnch, body.bagCode)))
      problems.push({ path: 'bagCode', message: 'Unknown bag' });
  }
  if (body.bagColour !== null && body.bagColour !== undefined) {
    if (!(await refExists(tx, MASTERS['bag-colours'], brnch, body.bagColour)))
      problems.push({ path: 'bagColour', message: 'Unknown bag colour' });
  }
  if (problems.length) throw Errors.validation('The SRF refers to unknown data', problems);
  return c;
}

/** BR-SRF-04: tax fields default from the customer master when not given. */
function withTaxDefaults(body, c) {
  const t = body.taxProfile ?? {};
  return {
    ...body,
    taxProfile: {
      stType: t.stType ?? c.salesTaxType ?? null,
      strn: t.strn ?? c.strn ?? null,
      ntn: t.ntn ?? c.ntn ?? null,
      cnic: t.cnic ?? c.cnic ?? null,
    },
    doHandoverTo: body.doHandoverTo ?? c.customerName ?? null,
  };
}

async function validTo(tx, brnch, srfDate) {
  const months = (await new SettingsReader(tx).num(brnch, 'CONTRACT_VALID_MONTHS')) ?? 3;
  return contractValidTo(srfDate, months);
}

/**
 * @param {import('../../lib/oracle/db.js').Tx} tx
 * @param {{ usrid: string, now: Date, audit: any }} actor
 */
export async function createSrf(tx, actor, brnch, input) {
  const c = await checkRefs(tx, brnch, input);
  const body = {
    ...withTaxDefaults(input, c),
    contractValidTo: await validTo(tx, brnch, input.srfDate),
  };
  const year = fiscalYearOf(toDate(input.srfDate));
  const srfNo = await nextNumber(tx, { brnch, year, docType: 'SRF' });
  await repo.insert(tx, { brnch, srfNo, year, body, usrid: actor.usrid, now: actor.now });
  await repo.writeSchedule(tx, { brnch, srfNo, srfDate: body.srfDate, lines: body.schedule });
  await recordAudit(tx, actor.audit, {
    entity: 'SALES_REQUEST_MASTER',
    key: `${brnch}|${srfNo}`,
    action: 'CREATE',
    brnch,
    newValues: body,
  });
  return getSrf(tx, brnch, srfNo);
}

function assertState(srf, to) {
  const t = checkTransition('SRF', srf.status, to);
  if (!t.ok) throw Errors.invalidState(`SRF ${srf.srfNo} is ${srf.status}: ${t.detail}`);
}

export async function updateSrf(tx, actor, brnch, srfNo, rowVer, input) {
  const before = await getSrf(tx, brnch, srfNo, { forUpdate: true });
  if (before.status !== 'DRAFT')
    throw Errors.invalidState(`SRF ${srfNo} is ${before.status}; only a DRAFT can be edited`);
  if (before.rowVer !== rowVer) throw Errors.versionConflict();
  const c = await checkRefs(tx, brnch, input);
  const body = {
    ...withTaxDefaults(input, c),
    contractValidTo: await validTo(tx, brnch, input.srfDate),
  };
  const n = await repo.update(tx, { brnch, srfNo, rowVer, body, ...actor });
  if (n !== 1) throw Errors.versionConflict();
  await repo.writeSchedule(tx, { brnch, srfNo, srfDate: body.srfDate, lines: body.schedule });
  await recordAudit(tx, actor.audit, {
    entity: 'SALES_REQUEST_MASTER',
    key: `${brnch}|${srfNo}`,
    action: 'UPDATE',
    brnch,
    oldValues: before,
    newValues: body,
  });
  return getSrf(tx, brnch, srfNo);
}

/** BR-SRF-05: submit creates exactly one draft OC (same transaction). */
export async function submitSrf(tx, actor, brnch, srfNo, rowVer) {
  const srf = await getSrf(tx, brnch, srfNo, { forUpdate: true });
  if (srf.rowVer !== rowVer) throw Errors.versionConflict();
  assertState(srf, 'SUBMITTED');
  if (srf.ocNo) throw Errors.invalidState(`SRF ${srfNo} already has OC ${srf.ocNo}`);
  // re-check what may have changed since the draft was saved
  await checkRefs(tx, brnch, srf);
  const problems = srfProblems(srf);
  if (problems.length)
    throw Errors.validation(
      'The SRF is not complete',
      problems.map((p) => ({ path: p.path.join('.'), message: p.message })),
    );
  const oc = await createDraftOc(tx, actor, srf);
  await repo.setStatus(tx, {
    brnch,
    srfNo,
    rowVer,
    status: 'SUBMITTED',
    ...actor,
    extra: { ocNo: oc.ocNo },
  });
  await recordAudit(tx, actor.audit, {
    entity: 'SALES_REQUEST_MASTER',
    key: `${brnch}|${srfNo}`,
    action: 'SUBMIT',
    brnch,
    newValues: { ocNo: oc.ocNo },
  });
  return { srf: await getSrf(tx, brnch, srfNo), oc };
}

/** BR-SRF-06: cancel while the OC is not confirmed; the draft OC is cancelled with it. */
export async function cancelSrf(tx, actor, brnch, srfNo, rowVer, reason) {
  const srf = await getSrf(tx, brnch, srfNo, { forUpdate: true });
  if (srf.rowVer !== rowVer) throw Errors.versionConflict();
  assertState(srf, 'CANCELLED');
  if (srf.ocNo) {
    const oc = await tx.one(
      `SELECT ${OC_STATUS_SQL} AS STATUS FROM ORDER_CONFIRM o WHERE o.BRNCH = :b AND o.ORDER_NO = :n FOR UPDATE`,
      { b: brnch, n: srf.ocNo },
    );
    if (oc && !SRF_CANCELLABLE_OC_STATES.includes(oc.STATUS)) {
      throw Errors.rule(
        'BR-SRF-06',
        `OC ${srf.ocNo} is ${oc.STATUS}; cancel the OC instead of the SRF`,
      );
    }
    if (oc)
      await cancelOcRow(tx, actor, { brnch, ocNo: srf.ocNo, reason: `SRF cancelled: ${reason}` });
  }
  await repo.setStatus(tx, {
    brnch,
    srfNo,
    rowVer,
    status: 'CANCELLED',
    ...actor,
    extra: { cancelReason: reason },
  });
  await recordAudit(tx, actor.audit, {
    entity: 'SALES_REQUEST_MASTER',
    key: `${brnch}|${srfNo}`,
    action: 'CANCEL',
    brnch,
    reason,
  });
  return getSrf(tx, brnch, srfNo);
}

/** Data of the Contract Review print (BR-SRF-07): SRF, customer contacts, clause texts. */
export async function contractReviewData(tx, brnch, srfNo) {
  const srf = await getSrf(tx, brnch, srfNo);
  const c = (await customers.getCustomer(tx, brnch, srf.customerCode)) ?? {};
  const clauses = await tx.many(
    `SELECT TEXT_CODE, TEXT_BODY FROM PRINT_TEXT
      WHERE BRNCH IN (0, :b) AND TEXT_CODE LIKE 'CRF!_%' ESCAPE '!' AND NVL(ACTIVE, 'Y') = 'Y'
        AND BRNCH = (SELECT MAX(p2.BRNCH) FROM PRINT_TEXT p2
                      WHERE p2.TEXT_CODE = PRINT_TEXT.TEXT_CODE AND p2.BRNCH IN (0, :b))
      ORDER BY TEXT_CODE, SR_NO`,
    { b: brnch },
  );
  const byCode = {};
  for (const r of clauses) (byCode[r.TEXT_CODE] ??= []).push(r.TEXT_BODY);
  const product = await tx.one(
    `SELECT PRODUCT_NAME FROM PRODUCT_DESC_T WHERE BRNCH = :b AND PRODUCT_CODE = :p ORDER BY PERIOD# DESC`,
    { b: brnch, p: srf.productCode },
  );
  const mot = await tx.one(
    'SELECT MODE_NAME FROM MODE_OF_TRANSPORT WHERE BRNCH = :b AND MODE_CODE = :m',
    { b: brnch, m: srf.modeOfTransport },
  );
  return {
    brnch,
    srf,
    customer: {
      customerName: c.customerName ?? null,
      mobile: c.mobile ?? null,
      phone: c.phone ?? null,
      email: c.email ?? null,
      address1: c.address1 ?? null,
      address2: c.address2 ?? null,
    },
    productName: product?.PRODUCT_NAME ?? null,
    transportName: mot?.MODE_NAME ?? null,
    clauses: byCode,
    preparedBy: srf.createdBy,
    approvedBy: srf.approvedBy,
  };
}
