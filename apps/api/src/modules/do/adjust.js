// DO quantity adjustment advice (BUSINESS_RULES BR-DO-06, §13; TASKS P2-06). A request writes a
// DO_ADJUSTMENT advice (number from the DOA counter, QUANTITY/AMOUNT = signed difference, as the
// legacy rows) and goes to the DO_ADJUST approval rule; when approved (or straight away when no
// rule is active) the DO quantity/value change, the QR version goes up (BR-QR-03: the old print
// is no longer valid) and the difference is posted to the DO ledger (DOA, Dr increase / Cr
// reduction). An increase needs the available balance (BR-BAL-02, customer locked) — a default to
// confirm with Finance. One pending advice per DO.
import { businessDate, dec, doAdjustment, fiscalYearOf, narration, tonsToBags } from '@dcl/shared';
import { branchFilter } from '../../lib/branch-scope.js';
import { Errors } from '../../lib/errors.js';
import { paginate } from '../../lib/oracle/paginate.js';
import { onApproved, onRejected, requestApproval } from '../approvals/service.js';
import { recordAudit } from '../audit/service.js';
import * as balance from '../ledger/balance.js';
import * as ledger from '../ledger/service.js';
import { nextNumber } from '../numbering/service.js';
import { getDo, keyOf } from './service.js';

const ENTITY = 'DO_ADJUSTMENT';
const OPEN = ['ISSUED', 'PARTLY_DISPATCHED', 'ON_HOLD'];
const adviceKey = (brnch, year, no) => `${brnch}|${year}|${no}`;
const parseAdviceKey = (k) => {
  const [b, y, n] = String(k).split('|');
  return { brnch: Number(b), year: Number(y), adviceNo: Number(n) };
};
const toDate = (s) => new Date(`${s}T00:00:00+05:00`);

const COLS = `a.BRNCH, a.ADVICE_YR, a.ADVICE_NO, a.ADVICE_DT, a.CUSTOMER_CODE, c.CUSTOMER_NAME,
  TO_CHAR(a.DO_NO) AS DO_NO, TO_CHAR(a.OC_NO) AS OC_NO, a.QUANTITY, a.AMOUNT, a.AUTHORISED_BY,
  NVL(a.DOC_STATUS, 'APPROVED') AS STATUS, a.ROW_VER, NVL(a.CREATED_BY, a.ENTER_BY) AS CREATED_BY,
  NVL(a.CREATED_ON, a.ENTER_DATE) AS CREATED_ON, a.ADJUST_REASON,
  (SELECT MIN(d.DO_TYPE) FROM DELIVERY_ORDER d WHERE d.BRNCH = a.BRNCH AND d.DEL_ORDER_NO = a.DO_NO) AS DO_TYPE`;
const FROM = `DO_ADJUSTMENT a
  LEFT JOIN CUSTOMER_INFO c ON c.BRNCH = a.BRNCH AND c.CUSTOMER_CODE = a.CUSTOMER_CODE`;

function mapAdvice(r) {
  return {
    brnch: Number(r.BRNCH),
    year: Number(r.ADVICE_YR),
    adviceNo: String(r.ADVICE_NO),
    adviceDate: r.ADVICE_DT ? businessDate(r.ADVICE_DT) : null,
    customerCode: r.CUSTOMER_CODE,
    customerName: r.CUSTOMER_NAME ?? null,
    doType: r.DO_TYPE ?? null,
    doNo: r.DO_NO ?? null,
    ocNo: r.OC_NO ?? null,
    deltaTon: dec(r.QUANTITY ?? 0).toFixed(3),
    deltaValue: dec(r.AMOUNT ?? 0).toFixed(2),
    status: r.STATUS,
    authorisedBy: r.AUTHORISED_BY ?? null,
    createdBy: r.CREATED_BY ?? null,
    createdOn: r.CREATED_ON ?? null,
    reason: r.ADJUST_REASON ?? null,
    rowVer: Number(r.ROW_VER ?? 0),
  };
}

/** @param {{ branches: number[], status?: string, doNo?: string, customer?: string, page?: number, pageSize?: number }} o */
export async function listAdvices(tx, o) {
  const bf = branchFilter('a.BRNCH', o.branches);
  const binds = { ...bf.binds };
  const where = [bf.sql];
  if (o.status) {
    where.push(`NVL(a.DOC_STATUS, 'APPROVED') = :st`);
    binds.st = o.status;
  }
  if (o.doNo) {
    where.push('a.DO_NO = :dn');
    binds.dn = o.doNo;
  }
  if (o.customer) {
    where.push('a.CUSTOMER_CODE = :cu');
    binds.cu = o.customer;
  }
  const page = await paginate(tx, {
    sql: `SELECT ${COLS} FROM ${FROM} WHERE ${where.join(' AND ')}
          ORDER BY a.ADVICE_DT DESC, a.ADVICE_NO DESC, a.BRNCH`,
    binds,
    page: o.page,
    pageSize: o.pageSize,
  });
  return { ...page, items: page.items.map(mapAdvice) };
}

async function getAdvice(tx, brnch, year, adviceNo, { forUpdate = false } = {}) {
  const k = { b: brnch, y: year, n: adviceNo };
  if (forUpdate)
    await tx.one(
      'SELECT ADVICE_NO FROM DO_ADJUSTMENT WHERE BRNCH = :b AND ADVICE_YR = :y AND ADVICE_NO = :n FOR UPDATE',
      k,
    );
  const r = await tx.one(
    `SELECT ${COLS} FROM ${FROM} WHERE a.BRNCH = :b AND a.ADVICE_YR = :y AND a.ADVICE_NO = :n`,
    k,
  );
  if (!r) throw Errors.notFound(`DO adjustment advice ${adviceNo}`);
  return mapAdvice(r);
}

/** BR-DO-06 checks; an increase also needs the available balance (customer locked, BR-BAL-02). */
async function checked(tx, actor, d, qtyTon) {
  if (!OPEN.includes(d.status))
    throw Errors.invalidState(`DO ${d.doNo} is ${d.status}: only an open DO can be adjusted`);
  const calc = doAdjustment(d, qtyTon);
  if (calc.error) throw Errors.rule(calc.error.ruleId, calc.error.detail);
  if (calc.increase) {
    await balance.lockCustomer(tx, d.brnch, d.customerCode);
    const bal = await balance.available(tx, {
      brnch: d.brnch,
      customerCode: d.customerCode,
      now: actor.now,
      value: calc.deltaValue,
    });
    if (dec(bal.shortfall).gt(0))
      throw Errors.rule(
        'BR-BAL-03',
        `The increase of ${calc.deltaValue} is more than the available balance ${bal.available}`,
        { shortfall: bal.shortfall, available: bal.available },
      );
  }
  return calc;
}

/** Apply an advice to its DO: quantity, value, bags, QR version, DO ledger DOA. */
async function applyAdvice(tx, actor, advice) {
  const d = await getDo(tx, advice.brnch, advice.doType, advice.doNo, { forUpdate: true });
  const target = dec(d.qtyTon).plus(dec(advice.deltaTon)).toFixed(3);
  const calc = await checked(tx, actor, d, target);
  const sets = {
    DO_QUANTITY: calc.toTon,
    DO_VALUE: calc.newValue,
    NO_OF_BAGS: d.bags === null ? null : tonsToBags(calc.toTon).toNumber(),
  };
  const n = await tx.exec(
    `UPDATE DELIVERY_ORDER SET DO_QUANTITY = :q, DO_VALUE = :v, NO_OF_BAGS = :bg,
       QR_VER = NVL(QR_VER, 1) + 1, ROW_VER = ROW_VER + 1, UPDATED_BY = :u, UPDATED_ON = :now
       ${calc.fullyDispatched ? ", DOC_STATUS = 'DISPATCHED'" : ''}
     WHERE BRNCH = :b AND DO_TYPE = :t AND DEL_ORDER_NO = :n AND ROW_VER = :rv`,
    {
      q: sets.DO_QUANTITY,
      v: sets.DO_VALUE,
      bg: sets.NO_OF_BAGS,
      u: actor.usrid,
      now: actor.now,
      b: d.brnch,
      t: d.doType,
      n: d.doNo,
      rv: d.rowVer,
    },
  );
  if (n !== 1) throw Errors.versionConflict();
  const amt = dec(calc.deltaValue);
  await ledger.post(tx, actor, [
    {
      brnch: d.brnch,
      customerCode: d.customerCode,
      ledgerType: 'DO',
      entryDate: businessDate(actor.now),
      docType: 'DOA',
      docYear: fiscalYearOf(actor.now),
      docNo: advice.adviceNo,
      entryKind: 'ADJUST',
      narration: narration.adjust({ what: 'DO', no: d.doNo, fromTon: d.qtyTon, toTon: calc.toTon }),
      ...(amt.gt(0) ? { debit: amt.toFixed(2) } : { credit: amt.abs().toFixed(2) }),
      qtyTon: dec(calc.deltaTon).abs().toFixed(3),
    },
  ]);
  await tx.exec(
    `UPDATE DO_ADJUSTMENT SET DOC_STATUS = 'APPROVED', AUTHORISED_BY = :u40, ROW_VER = ROW_VER + 1,
       UPDATED_BY = :u, UPDATED_ON = :now
     WHERE BRNCH = :b AND ADVICE_YR = :y AND ADVICE_NO = :n`,
    {
      u40: actor.usrid.slice(0, 40),
      u: actor.usrid,
      now: actor.now,
      b: advice.brnch,
      y: advice.year,
      n: Number(advice.adviceNo),
    },
  );
  await recordAudit(tx, actor.audit, {
    entity: 'DELIVERY_ORDER',
    key: keyOf(d.brnch, d.doType, d.doNo),
    action: 'ADJUST',
    brnch: d.brnch,
    reason: advice.reason,
    oldValues: { qtyTon: d.qtyTon, value: d.value },
    newValues: { qtyTon: calc.toTon, value: calc.newValue, adviceNo: advice.adviceNo },
  });
  return calc;
}

/**
 * Request a quantity change: writes the advice, then the approval request (DO_ADJUST) or, when no
 * rule is active, applies it at once.
 */
export async function requestAdjust(tx, actor, brnch, doType, doNo, rowVer, { qtyTon, reason }) {
  const d = await getDo(tx, brnch, doType, doNo, { forUpdate: true });
  if (d.rowVer !== rowVer) throw Errors.versionConflict();
  const calc = await checked(tx, actor, d, qtyTon);
  const pending = await tx.one(
    `SELECT ADVICE_NO FROM DO_ADJUSTMENT WHERE BRNCH = :b AND DO_NO = :n AND DOC_STATUS = 'PENDING_APPROVAL'`,
    { b: brnch, n: doNo },
  );
  if (pending)
    throw Errors.invalidState(
      `Advice ${pending.ADVICE_NO} for this DO is still waiting for approval`,
    );
  const today = businessDate(actor.now);
  // ADVICE_YR as the legacy rows (calendar year of the advice); number from the fiscal-year counter
  const year = Number(today.slice(0, 4));
  const adviceNo = Number(
    await nextNumber(tx, { brnch, year: fiscalYearOf(actor.now), docType: 'DOA' }),
  );
  await tx.exec(
    `INSERT INTO DO_ADJUSTMENT (BRNCH, ADVICE_YR, ADVICE_NO, ADVICE_DT, CUSTOMER_CODE, PERIOD_FROM, PERIOD_TO,
       AMOUNT, QUANTITY, DO_NO, OC_NO, ENTER_BY, ENTER_DATE, COMPC, DOC_STATUS, ROW_VER, CREATED_BY,
       CREATED_ON, ADJUST_REASON)
     VALUES (:b, :y, :n, :d, :c, :d, :d, :amt, :q, :dn, :oc, :u10, :now, 1, 'PENDING_APPROVAL', 1, :u,
       :now, :r)`,
    {
      b: brnch,
      y: year,
      n: adviceNo,
      d: toDate(today),
      c: d.customerCode,
      amt: calc.deltaValue,
      q: calc.deltaTon,
      dn: doNo,
      oc: d.ocNo,
      u10: actor.usrid.slice(0, 10),
      u: actor.usrid,
      now: actor.now,
      r: reason.slice(0, 500),
    },
  );
  const key = adviceKey(brnch, year, adviceNo);
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key,
    action: 'CREATE',
    brnch,
    reason,
    newValues: { doNo, ...calc },
  });
  const res = await requestApproval(
    tx,
    { ...actor.audit, now: actor.now },
    {
      brnch,
      docType: 'DO_ADJUST',
      docKey: key,
      action: 'DO_ADJUST',
      snapshot: { doType, doNo, ...calc, reason },
      amount: dec(calc.deltaValue).abs().toFixed(2),
      qty: dec(calc.deltaTon).abs().toFixed(3),
      reason,
    },
  );
  const advice = await getAdvice(tx, brnch, year, adviceNo);
  if (!res.required) await applyAdvice(tx, actor, advice);
  return {
    advice: await getAdvice(tx, brnch, year, adviceNo),
    requestId: res.required ? res.requestId : null,
    do: await getDo(tx, brnch, doType, doNo),
  };
}

onApproved('DO_ADJUST', async (tx, req, ctx) => {
  const k = parseAdviceKey(req.docKey);
  const a = await getAdvice(tx, k.brnch, k.year, k.adviceNo, { forUpdate: true });
  if (a.status !== 'PENDING_APPROVAL') return;
  await applyAdvice(tx, { usrid: ctx.usrid, now: ctx.now, audit: ctx }, a);
});

onRejected('DO_ADJUST', async (tx, req, ctx) => {
  const k = parseAdviceKey(req.docKey);
  const n = await tx.exec(
    `UPDATE DO_ADJUSTMENT SET DOC_STATUS = 'REJECTED', ROW_VER = ROW_VER + 1, UPDATED_BY = :u, UPDATED_ON = :now
      WHERE BRNCH = :b AND ADVICE_YR = :y AND ADVICE_NO = :n AND DOC_STATUS = 'PENDING_APPROVAL'`,
    { u: ctx.usrid, now: ctx.now, b: k.brnch, y: k.year, n: k.adviceNo },
  );
  if (n)
    await recordAudit(tx, ctx, {
      entity: ENTITY,
      key: req.docKey,
      action: 'REJECT',
      brnch: k.brnch,
    });
});
