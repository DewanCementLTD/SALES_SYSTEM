// Credit limits (BR-CUS-07, TASKS P1-04): a limit changes only through an approved Credit Limit
// document (CREDIT_LIMITS_F, number from DOC_SEQUENCE 'CLM'); approval via the engine
// (CREDIT_LIMIT / action CREDIT_LIMIT_SET) or directly by customer.credit_limit_approve when no
// rule is active — never by the maker.
import { CREDIT_TYPE_COLUMNS, CREDIT_TYPES, dec, unusedCredit } from '@dcl/shared';
import { Errors } from '../../lib/errors.js';
import { decide, onApproved, onRejected, requestApproval } from '../approvals/service.js';
import { recordAudit } from '../audit/service.js';
import { nextNumber } from '../numbering/service.js';
import * as repo from './repo.js';

const money = (v) => (v === null || v === undefined ? null : dec(v).toFixed(2));
const docKey = (brnch, serno) => `${brnch}|${serno}`;

/** Limits per type + legacy single limit (BR-BAL-06) + documents. */
export async function creditOverview(tx, brnch, code) {
  const cols = Object.values(CREDIT_TYPE_COLUMNS);
  const cur = await tx.one(
    `SELECT ${cols.map((c) => `${c}, ${c}_A`).join(', ')} FROM CREDIT_LIMITS WHERE BRNCH = :b AND CUSTOMER_CODE = :c`,
    { b: brnch, c: code },
  );
  const init = await tx.one(
    `SELECT ${cols.join(', ')}, CREDIT_LIMITE FROM CUSTOMER_INFO WHERE BRNCH = :b AND CUSTOMER_CODE = :c`,
    { b: brnch, c: code },
  );
  if (!init) throw Errors.notFound('Customer');
  const names = await tx.many('SELECT CREDIT_CODE, CREDIT_DESC FROM CREDIT_TYPE WHERE BRNCH = :b', {
    b: brnch,
  });
  const nameOf = Object.fromEntries(names.map((n) => [n.CREDIT_CODE, n.CREDIT_DESC]));
  const types = CREDIT_TYPES.map((t) => {
    const col = CREDIT_TYPE_COLUMNS[t];
    return {
      creditType: t,
      description: nameOf[t] ?? col,
      initial: money(init[col]),
      current: money(cur?.[col]),
      availed: money(cur?.[`${col}_A`]),
      unused: unusedCredit(cur?.[col], cur?.[`${col}_A`]),
    };
  });
  return {
    hasCreditLimitsRow: !!cur,
    // BR-BAL-06: without a CREDIT_LIMITS row the customer's single CREDIT_LIMITE applies
    legacyCreditLimit: money(init.CREDIT_LIMITE),
    totalCurrent: types.reduce((s, x) => s.plus(x.current ?? 0), dec(0)).toFixed(2),
    types,
    documents: await documents(tx, { branches: [brnch], customerCode: code }),
  };
}

function mapDoc(r) {
  return {
    brnch: Number(r.BRNCH),
    serno: Number(r.SERNO),
    customerCode: r.CUSTOMER_CODE,
    customerName: r.CUSTOMER_NAME ?? null,
    date: r.WDATE ?? null,
    creditType: r.PTYPE ?? null,
    lastApproved: money(r.LAST_APROVED),
    amount: money(r.AP_AMOUNT),
    ocBalance: money(r.OC_BAL),
    remark: r.REMARK ?? null,
    // legacy documents have no DOC_STATUS: they were approved in the old system
    status: r.DOC_STATUS ?? 'APPROVED',
    createdBy: r.CREATED_BY ?? null,
    rowVer: Number(r.ROW_VER),
  };
}

/** Credit Limit documents (newest first). */
export async function documents(tx, { branches, customerCode, status, limit = 200 }) {
  const binds = { lim: limit };
  const where = [`f.BRNCH IN (${branches.map((b, i) => `:br${i}`).join(', ')})`];
  branches.forEach((b, i) => {
    binds[`br${i}`] = b;
  });
  if (customerCode) {
    where.push('f.CUSTOMER_CODE = :c');
    binds.c = customerCode;
  }
  if (status) {
    where.push(`NVL(f.DOC_STATUS, 'APPROVED') = :st`);
    binds.st = status;
  }
  const rows = await tx.many(
    `SELECT * FROM (
       SELECT f.BRNCH, f.SERNO, f.CUSTOMER_CODE, f.WDATE, f.PTYPE, f.LAST_APROVED, f.AP_AMOUNT, f.OC_BAL, f.REMARK,
              f.DOC_STATUS, f.CREATED_BY, f.ROW_VER, c.CUSTOMER_NAME
         FROM CREDIT_LIMITS_F f
         LEFT JOIN CUSTOMER_INFO c ON c.BRNCH = f.BRNCH AND c.CUSTOMER_CODE = f.CUSTOMER_CODE
        WHERE ${where.join(' AND ')}
        ORDER BY f.WDATE DESC, f.SERNO DESC)
     WHERE ROWNUM <= :lim`,
    binds,
  );
  return rows.map(mapDoc);
}

async function loadDoc(tx, brnch, serno, { forUpdate = false } = {}) {
  const r = await tx.one(
    `SELECT f.*, NULL AS CUSTOMER_NAME FROM CREDIT_LIMITS_F f WHERE f.BRNCH = :b AND f.SERNO = :s${forUpdate ? ' FOR UPDATE' : ''}`,
    { b: brnch, s: serno },
  );
  if (!r) throw Errors.notFound('Credit limit document');
  return mapDoc(r);
}

/**
 * New Credit Limit document for one credit type (customer.credit_limit).
 * @param {{ usrid: string, audit: any, now: Date, fiscalYear: number }} actor
 */
export async function requestCreditLimit(tx, actor, brnch, code, body) {
  const c = await repo.getCustomer(tx, brnch, code, { forUpdate: true });
  if (!c) throw Errors.notFound('Customer');
  if (c.status === 'CLOSED')
    throw Errors.invalidState('A closed customer cannot get a credit limit');
  const col = CREDIT_TYPE_COLUMNS[body.creditType];
  const cur = await tx.one(
    `SELECT ${col} AS CUR FROM CREDIT_LIMITS WHERE BRNCH = :b AND CUSTOMER_CODE = :c`,
    { b: brnch, c: code },
  );
  const open = await tx.one(
    `SELECT SERNO FROM CREDIT_LIMITS_F WHERE BRNCH = :b AND CUSTOMER_CODE = :c AND PTYPE = :t AND DOC_STATUS = 'PENDING_APPROVAL'`,
    { b: brnch, c: code, t: body.creditType },
  );
  if (open) {
    throw Errors.duplicate(
      `Credit limit document ${open.SERNO} for type ${body.creditType} is still waiting for approval`,
    );
  }
  const serno = await nextNumber(tx, { brnch, year: actor.fiscalYear, docType: 'CLM' });
  await tx.exec(
    `INSERT INTO CREDIT_LIMITS_F (SERNO, CUSTOMER_CODE, WDATE, OC_BAL, LAST_APROVED, AP_AMOUNT, REMARK, PTYPE, COMPC, BRNCH,
        DOC_STATUS, ROW_VER, CREATED_BY, CREATED_ON)
     VALUES (TO_NUMBER(:s), :c, TRUNC(:now), NULL, :last, :amt, :remark, :t, 1, :b, 'PENDING_APPROVAL', 1, :usr, :now)`,
    {
      s: serno,
      c: code,
      now: actor.now,
      last: cur?.CUR === null || cur?.CUR === undefined ? null : dec(cur.CUR).toString(),
      amt: dec(body.amount).toString(),
      remark: body.remark,
      t: body.creditType,
      b: brnch,
      usr: actor.usrid,
    },
  );
  await recordAudit(tx, actor.audit, {
    entity: 'CREDIT_LIMITS_F',
    key: docKey(brnch, serno),
    action: 'CREATE',
    brnch,
    newValues: { customerCode: code, ...body },
  });
  const r = await requestApproval(
    tx,
    { ...actor.audit, now: actor.now },
    {
      docType: 'CREDIT_LIMIT',
      brnch,
      docKey: docKey(brnch, serno),
      action: 'CREDIT_LIMIT_SET',
      amount: dec(body.amount).toFixed(2),
      snapshot: {
        customerCode: code,
        customerName: c.customerName,
        ...body,
        lastApproved: cur?.CUR ?? null,
      },
      reason: `Credit limit ${body.creditType} ${code}: ${body.remark}`,
    },
  );
  return {
    document: await loadDoc(tx, brnch, Number(serno)),
    requestId: r.required ? r.requestId : null,
  };
}

/** Apply an approved document to CREDIT_LIMITS (row created when missing). */
async function apply(tx, brnch, doc, { usrid, now }) {
  const col = CREDIT_TYPE_COLUMNS[doc.creditType];
  const n = await tx.exec(
    `UPDATE CREDIT_LIMITS SET ${col} = :amt WHERE BRNCH = :b AND CUSTOMER_CODE = :c`,
    { amt: doc.amount, b: brnch, c: doc.customerCode },
  );
  if (n === 0) {
    await tx.exec(
      `INSERT INTO CREDIT_LIMITS (CUSTOMER_CODE, ${col}, COMPC, BRNCH) VALUES (:c, :amt, 1, :b)`,
      { c: doc.customerCode, amt: doc.amount, b: brnch },
    );
  }
  await tx.exec(
    `UPDATE CREDIT_LIMITS_F SET DOC_STATUS = 'APPROVED', ROW_VER = ROW_VER + 1, UPDATED_BY = :usr, UPDATED_ON = :now
      WHERE BRNCH = :b AND SERNO = :s`,
    { usr: usrid, now, b: brnch, s: doc.serno },
  );
}

async function markRejected(tx, brnch, serno, { usrid, now }) {
  await tx.exec(
    `UPDATE CREDIT_LIMITS_F SET DOC_STATUS = 'REJECTED', ROW_VER = ROW_VER + 1, UPDATED_BY = :usr, UPDATED_ON = :now
      WHERE BRNCH = :b AND SERNO = :s`,
    { usr: usrid, now, b: brnch, s: serno },
  );
}

/** Approve / reject a document (customer.credit_limit_approve; maker ≠ checker). */
export async function decideCreditLimit(tx, ctx, brnch, serno, decision, comment) {
  const doc = await loadDoc(tx, brnch, serno, { forUpdate: true });
  if (doc.status !== 'PENDING_APPROVAL') {
    throw Errors.invalidState(`Credit limit document ${serno} is ${doc.status.toLowerCase()}`);
  }
  const pending = await tx.one(
    `SELECT REQ_ID FROM APPROVAL_REQUEST WHERE DOC_TYPE = 'CREDIT_LIMIT' AND DOC_KEY = :k AND STATUS = 'PENDING'`,
    { k: docKey(brnch, serno) },
  );
  if (pending) {
    await decide(tx, ctx, { reqId: Number(pending.REQ_ID), decision, comment });
  } else {
    if (doc.createdBy === ctx.usrid) throw Errors.makerChecker(undefined, 'BR-CUS-07');
    if (decision === 'APPROVED') await apply(tx, brnch, doc, ctx);
    else await markRejected(tx, brnch, serno, ctx);
    await recordAudit(tx, ctx, {
      entity: 'CREDIT_LIMITS_F',
      key: docKey(brnch, serno),
      action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
      brnch,
      reason: comment ?? null,
    });
  }
  return loadDoc(tx, brnch, serno);
}

const keyOf = (req) => {
  const [b, s] = req.docKey.split('|');
  return { brnch: Number(b), serno: Number(s) };
};
onApproved('CREDIT_LIMIT_SET', async (tx, req, ctx) => {
  const { brnch, serno } = keyOf(req);
  await apply(tx, brnch, await loadDoc(tx, brnch, serno, { forUpdate: true }), ctx);
});
onRejected('CREDIT_LIMIT_SET', async (tx, req, ctx) => {
  const { brnch, serno } = keyOf(req);
  await markRejected(tx, brnch, serno, ctx);
});
