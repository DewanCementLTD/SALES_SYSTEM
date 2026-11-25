// Tax withheld by customers (TASKS P4-05, SCHEMA TAX_WITHHELD, REQUIREMENTS_SPEC R12 block 7):
// a register of income tax (IT) / sales tax (ST) that customers deducted when paying DCL, and the
// tax certificates received against each entry (CERT_RECEIVED, never above the amount). It does
// not post to the customer ledgers (BUSINESS_RULES §13 lists no posting for it). Rows are never
// changed except CERT_RECEIVED: a wrong entry is cancelled by a reversing entry (negative amount,
// DOC_TYPE 'REV', DOC_NO = the entry), allowed while no certificate was recorded on it.
// Permissions: note.view / note.create (no tax-withheld permission in PERMISSIONS.md: default to
// confirm with Finance).
import { dec, moneyStr } from '@dcl/shared';
import { branchFilter } from '../../lib/branch-scope.js';
import { Errors } from '../../lib/errors.js';
import { paginate } from '../../lib/oracle/paginate.js';
import { recordAudit } from '../audit/service.js';

const ENTITY = 'TAX_WITHHELD';
const COLS = `w.TW_ID, w.BRNCH, w.CUSTOMER_CODE, c.CUSTOMER_NAME, w.TAX_KIND, w.DOC_TYPE, w.DOC_NO,
  TO_CHAR(w.TW_DATE, 'YYYY-MM-DD') AS TW_DATE, w.AMOUNT, w.CERT_RECEIVED, w.REMARKS, w.CREATED_BY,
  w.CREATED_ON,
  (SELECT MIN(r.TW_ID) FROM TAX_WITHHELD r WHERE r.BRNCH = w.BRNCH AND r.DOC_TYPE = 'REV'
     AND r.DOC_NO = TO_CHAR(w.TW_ID)) AS REVERSED_BY`;
const FROM = `TAX_WITHHELD w
  LEFT JOIN CUSTOMER_INFO c ON c.BRNCH = w.BRNCH AND c.CUSTOMER_CODE = w.CUSTOMER_CODE`;

function map(r) {
  const amount = dec(r.AMOUNT);
  const cert = dec(r.CERT_RECEIVED ?? 0);
  return {
    twId: Number(r.TW_ID),
    brnch: Number(r.BRNCH),
    customerCode: r.CUSTOMER_CODE,
    customerName: r.CUSTOMER_NAME ?? null,
    taxKind: r.TAX_KIND,
    docType: r.DOC_TYPE ?? null,
    docNo: r.DOC_NO ?? null,
    date: r.TW_DATE,
    amount: moneyStr(amount),
    certReceived: moneyStr(cert),
    outstanding: moneyStr(amount.minus(cert)),
    remarks: r.REMARKS ?? null,
    createdBy: r.CREATED_BY,
    createdOn: r.CREATED_ON,
    reversedBy: r.REVERSED_BY === null ? null : Number(r.REVERSED_BY),
  };
}

/** @param {{ branches: number[], customer?: string, kind?: string, from?: string, to?: string, page?: number, pageSize?: number }} o */
export async function list(tx, o) {
  const bf = branchFilter('w.BRNCH', o.branches);
  const binds = { ...bf.binds };
  const where = [bf.sql];
  if (o.customer) {
    where.push('w.CUSTOMER_CODE = :cu');
    binds.cu = o.customer;
  }
  if (o.kind) {
    where.push('w.TAX_KIND = :k');
    binds.k = o.kind;
  }
  if (o.from) {
    where.push(`w.TW_DATE >= TO_DATE(:fr, 'YYYY-MM-DD')`);
    binds.fr = o.from;
  }
  if (o.to) {
    where.push(`w.TW_DATE < TO_DATE(:tod, 'YYYY-MM-DD') + 1`);
    binds.tod = o.to;
  }
  const page = await paginate(tx, {
    sql: `SELECT ${COLS} FROM ${FROM} WHERE ${where.join(' AND ')} ORDER BY w.TW_DATE DESC, w.TW_ID DESC`,
    binds,
    page: o.page,
    pageSize: o.pageSize,
  });
  return { ...page, items: page.items.map(map) };
}

async function getOne(tx, twId, { forUpdate = false } = {}) {
  if (forUpdate)
    await tx.one('SELECT TW_ID FROM TAX_WITHHELD WHERE TW_ID = :id FOR UPDATE', { id: twId });
  const r = await tx.one(`SELECT ${COLS} FROM ${FROM} WHERE w.TW_ID = :id`, { id: twId });
  if (!r) throw Errors.notFound(`Tax withheld entry ${twId}`);
  return map(r);
}
export { getOne as getEntry };

/** Per customer and kind as of a date: withheld, certificates received, outstanding. */
export async function summary(tx, { brnch, asOf }) {
  const rows = await tx.many(
    `SELECT w.CUSTOMER_CODE, MAX(c.CUSTOMER_NAME) AS CUSTOMER_NAME, w.TAX_KIND,
            SUM(w.AMOUNT) AS AMT, SUM(w.CERT_RECEIVED) AS CERT
       FROM ${FROM}
      WHERE w.BRNCH = :b AND (:asof IS NULL OR w.TW_DATE < TO_DATE(:asof, 'YYYY-MM-DD') + 1)
      GROUP BY w.CUSTOMER_CODE, w.TAX_KIND
     HAVING SUM(w.AMOUNT) <> 0 OR SUM(w.CERT_RECEIVED) <> 0
      ORDER BY w.CUSTOMER_CODE, w.TAX_KIND`,
    { b: brnch, asof: asOf ?? null },
  );
  return rows.map((r) => ({
    customerCode: r.CUSTOMER_CODE,
    customerName: r.CUSTOMER_NAME ?? null,
    taxKind: r.TAX_KIND,
    amount: moneyStr(r.AMT),
    certReceived: moneyStr(r.CERT),
    outstanding: moneyStr(dec(r.AMT).minus(dec(r.CERT))),
  }));
}

/** POST /tax-withheld: one entry of my branch. */
export async function create(tx, actor, brnch, body) {
  const c = await tx.one(
    'SELECT 1 AS X FROM CUSTOMER_INFO WHERE BRNCH = :b AND CUSTOMER_CODE = :c',
    {
      b: brnch,
      c: body.customerCode,
    },
  );
  if (!c) throw Errors.notFound(`Customer ${body.customerCode}`);
  const id = await tx.nextId('SEQ_TAX_WITHHELD');
  await tx.exec(
    `INSERT INTO TAX_WITHHELD (TW_ID, BRNCH, CUSTOMER_CODE, TAX_KIND, DOC_TYPE, DOC_NO, TW_DATE, AMOUNT,
       CERT_RECEIVED, REMARKS, CREATED_BY, CREATED_ON)
     VALUES (:id, :b, :c, :k, :dt, :dn, TO_DATE(:d, 'YYYY-MM-DD'), :amt, 0, :rem, :u, :now)`,
    {
      id,
      b: brnch,
      c: body.customerCode,
      k: body.taxKind,
      dt: body.docType ?? null,
      dn: body.docNo ?? null,
      d: body.date,
      amt: body.amount,
      rem: body.remarks ?? null,
      u: actor.usrid,
      now: actor.now,
    },
  );
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: String(id),
    action: 'CREATE',
    brnch,
    newValues: body,
  });
  return getOne(tx, id);
}

/** Record a certificate received against an entry (cumulative, never above the amount). */
export async function addCertificate(tx, actor, twId, { amount, remarks }) {
  const e = await getOne(tx, twId, { forUpdate: true });
  if (dec(e.amount).lte(0) || e.docType === 'REV' || e.reversedBy)
    throw Errors.invalidState('Certificates are recorded on open withheld entries only');
  const next = dec(e.certReceived).plus(dec(amount));
  if (next.gt(dec(e.amount)))
    throw Errors.rule(
      'R12',
      `Certificates would exceed the amount withheld (${e.amount}; already received ${e.certReceived})`,
    );
  await tx.exec('UPDATE TAX_WITHHELD SET CERT_RECEIVED = :v WHERE TW_ID = :id', {
    v: moneyStr(next),
    id: twId,
  });
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: String(twId),
    action: 'CERTIFICATE',
    brnch: e.brnch,
    reason: remarks ?? null,
    oldValues: { certReceived: e.certReceived },
    newValues: { certReceived: moneyStr(next), added: amount },
  });
  return getOne(tx, twId);
}

/** Cancel an entry by a reversing entry (no certificate recorded on it yet). */
export async function reverse(tx, actor, twId, reason) {
  const e = await getOne(tx, twId, { forUpdate: true });
  if (e.docType === 'REV') throw Errors.invalidState('This entry is itself a reversal');
  if (e.reversedBy) throw Errors.invalidState(`Already reversed by entry ${e.reversedBy}`);
  if (dec(e.certReceived).gt(0))
    throw Errors.invalidState('A certificate was recorded on this entry: it cannot be reversed');
  const id = await tx.nextId('SEQ_TAX_WITHHELD');
  await tx.exec(
    `INSERT INTO TAX_WITHHELD (TW_ID, BRNCH, CUSTOMER_CODE, TAX_KIND, DOC_TYPE, DOC_NO, TW_DATE, AMOUNT,
       CERT_RECEIVED, REMARKS, CREATED_BY, CREATED_ON)
     VALUES (:id, :b, :c, :k, 'REV', :dn, TO_DATE(:d, 'YYYY-MM-DD'), :amt, 0, :rem, :u, :now)`,
    {
      id,
      b: e.brnch,
      c: e.customerCode,
      k: e.taxKind,
      dn: String(twId),
      d: e.date,
      amt: dec(e.amount).negated().toFixed(2),
      rem: `Reverses entry ${twId}: ${reason}`.slice(0, 400),
      u: actor.usrid,
      now: actor.now,
    },
  );
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: String(twId),
    action: 'REVERSE',
    brnch: e.brnch,
    reason,
    newValues: { reversedBy: id },
  });
  return getOne(tx, id);
}
