// Tax rates (TASKS P1-05). WHT rates: TAX_RATE rows (BR-TAX-05). FED / sales tax: a new
// PRODUCT_DESC_T period (BR-TAX-02/03/10). Both are rate changes: approval rule RATE_CHANGE
// (BR-PRC-06); when no rule applies the change takes effect at once. Rows are never edited.
import { businessDate, dec, effectiveTaxRate } from '@dcl/shared';
import { Errors } from '../../lib/errors.js';
import { onApproved, onRejected, requestApproval } from '../approvals/service.js';
import { recordAudit } from '../audit/service.js';

/** @typedef {import('../../lib/oracle/db.js').Tx} Tx */

const toDate = (iso) => new Date(`${iso}T00:00:00+05:00`);

function mapRate(r) {
  return {
    taxRateId: Number(r.TAX_RATE_ID),
    brnch: Number(r.BRNCH),
    kind: r.TAX_KIND,
    filerStatus: r.FILER_STATUS,
    section: r.SECTION,
    ratePct: dec(r.RATE_PCT).toString(),
    effectiveFrom: businessDate(r.EFFECTIVE_FROM),
    remarks: r.REMARKS ?? null,
    status: r.DOC_STATUS,
    createdBy: r.CREATED_BY,
    createdOn: r.CREATED_ON,
    approvedBy: r.APPROVED_BY ?? null,
    approvedOn: r.APPROVED_ON ?? null,
  };
}

/** WHT rows visible in the given branches (plus both-branches rows), newest first. */
export async function listRates(tx, branches) {
  const binds = {};
  const ins = branches.map((b, i) => {
    binds[`b${i}`] = b;
    return `:b${i}`;
  });
  const rows = await tx.many(
    `SELECT * FROM TAX_RATE WHERE TAX_KIND = 'WHT' AND BRNCH IN (0, ${ins.join(', ')})
      ORDER BY FILER_STATUS, SECTION, EFFECTIVE_FROM DESC, TAX_RATE_ID DESC`,
    binds,
  );
  return rows.map(mapRate);
}

export async function effectiveRate(tx, q) {
  return effectiveTaxRate(await listRates(tx, [q.brnch]), q);
}

async function approveRate(tx, id, { usrid, now }) {
  await tx.exec(
    `UPDATE TAX_RATE SET DOC_STATUS = 'APPROVED', APPROVED_BY = :usr, APPROVED_ON = :now, ROW_VER = ROW_VER + 1
      WHERE TAX_RATE_ID = :id AND DOC_STATUS = 'PENDING_APPROVAL'`,
    { id, usr: usrid, now },
  );
}

/**
 * @param {Tx} tx
 * @param {{ usrid: string, audit: object, now: Date, brnch: number }} actor brnch = session branch
 * @param {{ brnch: number, filerStatus: string, section: string, ratePct: string, effectiveFrom: string, remarks?: string }} body
 */
export async function requestRate(tx, actor, body) {
  const dup = await tx.one(
    `SELECT TAX_RATE_ID FROM TAX_RATE WHERE TAX_KIND = 'WHT' AND BRNCH = :b AND FILER_STATUS = :f AND SECTION = :s
        AND EFFECTIVE_FROM = :d AND DOC_STATUS IN ('PENDING_APPROVAL','APPROVED')`,
    { b: body.scope, f: body.filerStatus, s: body.section, d: toDate(body.effectiveFrom) },
  );
  if (dup) throw Errors.duplicate('A rate for this filer status, section and date already exists');
  const id = await tx.nextId('SEQ_TAX_RATE');
  await tx.exec(
    `INSERT INTO TAX_RATE (TAX_RATE_ID, COMPC, BRNCH, TAX_KIND, FILER_STATUS, SECTION, RATE_PCT, EFFECTIVE_FROM, REMARKS,
        DOC_STATUS, ROW_VER, CREATED_BY, CREATED_ON)
     VALUES (:id, 1, :b, 'WHT', :f, :s, :r, :d, :rem, 'PENDING_APPROVAL', 1, :usr, :now)`,
    {
      id,
      b: body.scope,
      f: body.filerStatus,
      s: body.section,
      r: dec(body.ratePct).toString(),
      d: toDate(body.effectiveFrom),
      rem: body.remarks ?? null,
      usr: actor.usrid,
      now: actor.now,
    },
  );
  await recordAudit(tx, actor.audit, {
    entity: 'TAX_RATE',
    key: id,
    action: 'CREATE',
    brnch: body.scope || null,
    newValues: body,
  });
  const r = await requestApproval(
    tx,
    { ...actor.audit, now: actor.now },
    {
      docType: 'RATE_CHANGE',
      brnch: body.scope || actor.brnch,
      docKey: `TAX_RATE|${id}`,
      action: 'TAX_RATE_SET',
      snapshot: body,
      reason: `WHT ${body.filerStatus === 'F' ? 'filer' : body.filerStatus === 'N' ? 'non-filer' : 'exempt'}${body.section !== '-' ? ` ${body.section}` : ''} ${body.ratePct}% from ${body.effectiveFrom}`,
    },
  );
  if (!r.required) await approveRate(tx, id, actor);
  const row = await tx.one('SELECT * FROM TAX_RATE WHERE TAX_RATE_ID = :id', { id });
  return { rate: mapRate(row), requestId: r.required ? r.requestId : null };
}

/** Insert the approved period: other values copied from the latest period of the product. */
async function insertPeriod(tx, brnch, p) {
  const last = await tx.one(
    `SELECT * FROM PRODUCT_DESC_T WHERE BRNCH = :b AND PRODUCT_CODE = :c
      AND PERIOD# = (SELECT MAX(PERIOD#) FROM PRODUCT_DESC_T WHERE BRNCH = :b AND PRODUCT_CODE = :c)`,
    { b: brnch, c: p.productCode },
  );
  if (!last) throw Errors.notFound(`Product ${p.productCode}`);
  const retail = p.retailPrice ?? last.R_PRICE;
  const st =
    retail === null || retail === undefined
      ? null
      : dec(retail).times(p.salesTaxPer).div(100).toFixed(2);
  const period = Number(last['PERIOD#']) + 1;
  await tx.exec(
    `INSERT INTO PRODUCT_DESC_T (PRODUCT_CODE, PRODUCT_NAME, AVG_RATE, CED, CODE, PRODUCT_TYPE, R_PRICE, COMPANY_PRICE,
        P_SALES_TAX, P_SALES_TAX_PER, PERIOD#, DATE_FROM, DATE_TO, STATUS, BRAND, HSCODE, COMPC, BRNCH)
     VALUES (:c, :name, :avg, :fed, :mrp, :ptype, :retail, :company, :st, :stp, :period, :df, NULL, 'O', :brand, :hs, 1, :b)`,
    {
      c: p.productCode,
      name: last.PRODUCT_NAME,
      avg: last.AVG_RATE,
      fed: dec(p.fedPerTon).toString(),
      mrp: p.mrp ? dec(p.mrp).toString() : last.CODE,
      ptype: last.PRODUCT_TYPE,
      retail: p.retailPrice ? dec(p.retailPrice).toString() : last.R_PRICE,
      company: p.companyPrice ? dec(p.companyPrice).toString() : last.COMPANY_PRICE,
      st,
      stp: dec(p.salesTaxPer).toString(),
      period,
      df: toDate(p.dateFrom),
      brand: last.BRAND,
      hs: last.HSCODE,
      b: brnch,
    },
  );
  return period;
}

/** FED / sales tax change for a product = a new period (BR-TAX-10), after approval. */
export async function requestProductPeriod(tx, actor, brnch, body) {
  const last = await tx.one(
    `SELECT MAX(PERIOD#) AS P, MAX(DATE_FROM) AS D FROM PRODUCT_DESC_T WHERE BRNCH = :b AND PRODUCT_CODE = :c`,
    { b: brnch, c: body.productCode },
  );
  if (!last || last.P === null)
    throw Errors.notFound(`Product ${body.productCode} in branch ${brnch}`);
  if (last.D && businessDate(last.D) >= body.dateFrom) {
    throw Errors.rule(
      'BR-PRC-01',
      `A new period must start after the latest one (${businessDate(last.D)}); history is never changed`,
    );
  }
  const r = await requestApproval(
    tx,
    { ...actor.audit, now: actor.now },
    {
      docType: 'RATE_CHANGE',
      brnch,
      docKey: `PRODUCT_PERIOD|${brnch}|${body.productCode}|${body.dateFrom}`,
      action: 'PRODUCT_PERIOD_ADD',
      snapshot: { brnch, ...body },
      reason: `${body.productCode}: FED ${body.fedPerTon}/t, ST ${body.salesTaxPer}% from ${body.dateFrom}`,
    },
  );
  let period = null;
  if (!r.required) period = await insertPeriod(tx, brnch, body);
  await recordAudit(tx, actor.audit, {
    entity: 'PRODUCT_DESC_T',
    key: `${brnch}|${body.productCode}`,
    action: r.required ? 'REQUEST' : 'CREATE',
    brnch,
    newValues: { ...body, period },
  });
  return { requestId: r.required ? r.requestId : null, period };
}

/** Period changes waiting for approval in a branch. */
export async function pendingPeriods(tx, brnch) {
  const rows = await tx.many(
    `SELECT REQ_ID, SNAPSHOT, REQUESTED_BY, REQUESTED_ON FROM APPROVAL_REQUEST
      WHERE ACTION = 'PRODUCT_PERIOD_ADD' AND STATUS = 'PENDING' AND BRNCH = :b ORDER BY REQ_ID DESC`,
    { b: brnch },
  );
  return rows.map((r) => ({
    requestId: Number(r.REQ_ID),
    ...JSON.parse(r.SNAPSHOT),
    requestedBy: r.REQUESTED_BY,
    requestedOn: r.REQUESTED_ON,
  }));
}

// --- approval hooks ---
onApproved('TAX_RATE_SET', async (tx, req, ctx) => {
  await approveRate(tx, Number(req.docKey.split('|')[1]), ctx);
});
onRejected('TAX_RATE_SET', async (tx, req) => {
  await tx.exec(
    `UPDATE TAX_RATE SET DOC_STATUS = 'REJECTED', ROW_VER = ROW_VER + 1 WHERE TAX_RATE_ID = :id`,
    { id: Number(req.docKey.split('|')[1]) },
  );
});
onApproved('PRODUCT_PERIOD_ADD', async (tx, req) => {
  const { brnch, ...p } = req.snapshot;
  await insertPeriod(tx, brnch, p);
});
