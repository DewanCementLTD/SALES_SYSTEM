// Incentive schemes and runs (BUSINESS_RULES §14 BR-INC-01/03, TASKS P4-03).
//
// A scheme (INCENTIVE, number from the INC counter) names a period, a customer code range and
// products with a rate per ton (INCENTIVE_PRODUCT). Status: DRAFT → COMMITTED, or CANCELLED.
// Preview: invoiced tons per customer and product in the period (SALES_INVOICE, not cancelled,
// customers not closed) × rate. Commit (incentive.commit): the same calculation, written to
// INCENTIVE_DETAIL, and one DRAFT credit note per customer (type NOTE_TYPE_INCENTIVE, SOURCE_RUN
// "INC <no>") that then goes through the normal note approval (BR-NOTE-03). BR-INC-03: a
// customer + product already paid by another committed scheme with an overlapping period is
// refused at commit (and shown in the preview).
//
// INCENTIVE_DETAIL.CR_NOTE_NO is NUMBER(6) and cannot hold 8-digit note numbers: the notes are
// found through CREDIT_NOTE.SOURCE_RUN instead.
import {
  businessDate,
  dec,
  fiscalYearOf,
  formatAmount,
  incentiveRun,
  periodsOverlap,
  qtyStr,
} from '@dcl/shared';
import { branchFilter } from '../../lib/branch-scope.js';
import { Errors } from '../../lib/errors.js';
import { paginate } from '../../lib/oracle/paginate.js';
import { recordAudit } from '../audit/service.js';
import { createNote } from '../notes/service.js';
import { nextNumber } from '../numbering/service.js';
import { SettingsReader } from '../settings/service.js';

const ENTITY = 'INCENTIVE';
const key = (brnch, srlNo) => `${brnch}|${srlNo}`;
export const runTag = (srlNo) => `INC ${srlNo}`;
const toDate = (s) => new Date(`${s}T00:00:00+05:00`);
const iso = (col) => `TO_CHAR(${col}, 'YYYY-MM-DD')`;

const COLS = `i.BRNCH, i.SRL_NO, i.MEMO_NO, ${iso('i.MEMO_DATE')} AS MEMO_DATE,
  ${iso('i.DATE_FROM')} AS DATE_FROM, ${iso('i.DATE_TO')} AS DATE_TO, i.CUSTOMER_FROM, i.CUSTOMER_TO,
  i.REMARKS, NVL(i.DOC_STATUS, 'COMMITTED') AS STATUS, i.ROW_VER, i.TOTAL,
  NVL(i.CREATED_BY, i.ENTER_BY) AS CREATED_BY, NVL(i.CREATED_ON, i.ENTER_DATE) AS CREATED_ON,
  i.UPDATED_BY, i.UPDATED_ON, i.CANCEL_REASON`;

function mapScheme(r) {
  return {
    brnch: Number(r.BRNCH),
    srlNo: String(r.SRL_NO),
    memoNo: r.MEMO_NO ?? null,
    memoDate: r.MEMO_DATE,
    dateFrom: r.DATE_FROM,
    dateTo: r.DATE_TO,
    customerFrom: r.CUSTOMER_FROM,
    customerTo: r.CUSTOMER_TO,
    remarks: r.REMARKS ?? null,
    status: r.STATUS,
    rowVer: Number(r.ROW_VER ?? 0),
    total: r.TOTAL === null || r.TOTAL === undefined ? null : dec(r.TOTAL).toFixed(2),
    createdBy: r.CREATED_BY ?? null,
    createdOn: r.CREATED_ON ?? null,
    committedBy: r.STATUS === 'COMMITTED' ? (r.UPDATED_BY ?? null) : null,
    committedOn: r.STATUS === 'COMMITTED' ? (r.UPDATED_ON ?? null) : null,
    cancelReason: r.CANCEL_REASON ?? null,
  };
}

/** @param {{ branches: number[], status?: string, page?: number, pageSize?: number }} o */
export async function listSchemes(tx, o) {
  const bf = branchFilter('i.BRNCH', o.branches);
  const binds = { ...bf.binds };
  const where = [bf.sql];
  if (o.status) {
    where.push(`NVL(i.DOC_STATUS, 'COMMITTED') = :st`);
    binds.st = o.status;
  }
  const page = await paginate(tx, {
    sql: `SELECT ${COLS} FROM INCENTIVE i WHERE ${where.join(' AND ')}
          ORDER BY i.MEMO_DATE DESC, i.SRL_NO DESC, i.BRNCH`,
    binds,
    page: o.page,
    pageSize: o.pageSize,
  });
  return { ...page, items: page.items.map(mapScheme) };
}

async function productsOf(tx, brnch, srlNo) {
  const rows = await tx.many(
    `SELECT p.PRODUCT_CODE, p.RATE,
       (SELECT MAX(t.PRODUCT_NAME) FROM PRODUCT_DESC_T t WHERE t.BRNCH = p.BRNCH AND t.PRODUCT_CODE = p.PRODUCT_CODE) AS NAME
     FROM INCENTIVE_PRODUCT p WHERE p.BRNCH = :b AND p.SRL_NO = :n ORDER BY p.PRODUCT_CODE`,
    { b: brnch, n: srlNo },
  );
  return rows.map((r) => ({
    productCode: r.PRODUCT_CODE,
    productName: r.NAME ?? null,
    rate: dec(r.RATE ?? 0).toFixed(2),
  }));
}

/** Scheme with products; committed schemes also with their detail rows and credit notes. */
export async function getScheme(tx, brnch, srlNo, { forUpdate = false } = {}) {
  const k = { b: brnch, n: Number(srlNo) };
  if (forUpdate)
    await tx.one('SELECT SRL_NO FROM INCENTIVE WHERE BRNCH = :b AND SRL_NO = :n FOR UPDATE', k);
  const r = await tx.one(`SELECT ${COLS} FROM INCENTIVE i WHERE i.BRNCH = :b AND i.SRL_NO = :n`, k);
  if (!r) throw Errors.notFound(`Incentive scheme ${srlNo}`);
  const s = mapScheme(r);
  const details = (
    await tx.many(
      `SELECT d.SR_NO, d.CUSTOMER_CODE, c.CUSTOMER_NAME, d.PRODUCT_CODE, d.QUANTITY, d.RATE, d.AMOUNT
         FROM INCENTIVE_DETAIL d
         LEFT JOIN CUSTOMER_INFO c ON c.BRNCH = d.BRNCH AND c.CUSTOMER_CODE = d.CUSTOMER_CODE
        WHERE d.BRNCH = :b AND d.SRL_NO = :n ORDER BY d.SR_NO`,
      k,
    )
  ).map((d) => ({
    srNo: Number(d.SR_NO),
    customerCode: d.CUSTOMER_CODE,
    customerName: d.CUSTOMER_NAME ?? null,
    productCode: d.PRODUCT_CODE,
    qtyTon: dec(d.QUANTITY ?? 0).toFixed(3),
    rate: dec(d.RATE ?? 0).toFixed(2),
    amount: dec(d.AMOUNT ?? 0).toFixed(2),
  }));
  const notes = (
    await tx.many(
      `SELECT SRL_NO, CUSTOMER_CODE, NVL(NET_AMOUNT, AMOUNT) AS NET, NVL(DOC_STATUS, 'POSTED') AS STATUS
         FROM CREDIT_NOTE WHERE BRNCH = :b AND DB_CR_CD = 'C' AND SOURCE_RUN = :run ORDER BY SRL_NO`,
      { b: brnch, run: runTag(srlNo) },
    )
  ).map((x) => ({
    srlNo: String(x.SRL_NO),
    customerCode: x.CUSTOMER_CODE,
    net: dec(x.NET).toFixed(2),
    status: x.STATUS,
  }));
  return { ...s, products: await productsOf(tx, brnch, Number(srlNo)), details, notes };
}

/** POST /incentives/schemes: DRAFT scheme with its INC number. */
export async function createScheme(tx, actor, brnch, body) {
  for (const p of body.products) {
    const ok = await tx.one(
      'SELECT COUNT(*) AS N FROM PRODUCT_DESC_T WHERE BRNCH = :b AND PRODUCT_CODE = :p',
      { b: brnch, p: p.productCode },
    );
    if (!Number(ok.N))
      throw Errors.rule('BR-INC-01', `Product ${p.productCode} does not exist here`);
  }
  const srlNo = Number(
    await nextNumber(tx, { brnch, year: fiscalYearOf(actor.now), docType: 'INC' }),
  );
  await tx.exec(
    `INSERT INTO INCENTIVE (SRL_NO, MEMO_DATE, MEMO_NO, DATE_FROM, DATE_TO, CUSTOMER_FROM, CUSTOMER_TO,
       REMARKS, ENTER_BY, ENTER_DATE, POST, COMPC, BRNCH, DOC_STATUS, ROW_VER, CREATED_BY, CREATED_ON)
     VALUES (:n, :md, :mn, :df, :dt, :cf, :ct, :rem, :u10, :now, 'N', 1, :b, 'DRAFT', 1, :u, :now)`,
    {
      n: srlNo,
      md: toDate(body.memoDate),
      mn: body.memoNo ?? null,
      df: toDate(body.dateFrom),
      dt: toDate(body.dateTo),
      cf: body.customerFrom,
      ct: body.customerTo,
      rem: body.remarks ?? null,
      u10: actor.usrid.slice(0, 10),
      now: actor.now,
      b: brnch,
      u: actor.usrid,
    },
  );
  for (const p of body.products)
    await tx.exec(
      `INSERT INTO INCENTIVE_PRODUCT (SRL_NO, PRODUCT_CODE, RATE, COMPC, BRNCH) VALUES (:n, :p, :r, 1, :b)`,
      { n: srlNo, p: p.productCode, r: p.rate, b: brnch },
    );
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: key(brnch, srlNo),
    action: 'CREATE',
    brnch,
    newValues: body,
  });
  return getScheme(tx, brnch, srlNo);
}

/** Invoiced tons per customer and product in the scheme's period, range and products. */
async function dispatched(tx, s) {
  const rows = await tx.many(
    `SELECT i.CUSTOMER_CODE, MAX(c.CUSTOMER_NAME) AS CUSTOMER_NAME, i.PRODUCT_CODE,
            TO_CHAR(SUM(i.QTY_TON)) AS QTY
       FROM SALES_INVOICE i
       JOIN CUSTOMER_INFO c ON c.BRNCH = i.BRNCH AND c.CUSTOMER_CODE = i.CUSTOMER_CODE
      WHERE i.BRNCH = :b AND i.STATUS <> 'CANCELLED'
        AND i.INVOICE_DATE >= TO_DATE(:df, 'YYYY-MM-DD') AND i.INVOICE_DATE < TO_DATE(:dt, 'YYYY-MM-DD') + 1
        AND i.CUSTOMER_CODE BETWEEN :cf AND :ct
        AND NVL(c.CLOSED, 'N') <> 'Y' AND NVL(c.DOC_STATUS, '-') <> 'CLOSED'
        AND i.PRODUCT_CODE IN (SELECT p.PRODUCT_CODE FROM INCENTIVE_PRODUCT p WHERE p.BRNCH = :b AND p.SRL_NO = :n)
      GROUP BY i.CUSTOMER_CODE, i.PRODUCT_CODE
      ORDER BY i.CUSTOMER_CODE, i.PRODUCT_CODE`,
    {
      b: s.brnch,
      n: Number(s.srlNo),
      df: s.dateFrom,
      dt: s.dateTo,
      cf: s.customerFrom,
      ct: s.customerTo,
    },
  );
  return rows.map((r) => ({
    customerCode: r.CUSTOMER_CODE,
    customerName: r.CUSTOMER_NAME ?? null,
    productCode: r.PRODUCT_CODE,
    qtyTon: qtyStr(r.QTY),
  }));
}

/** BR-INC-03: customer + product already paid by another committed scheme of an overlapping period. */
async function alreadyPaid(tx, s) {
  const rows = await tx.many(
    `SELECT DISTINCT d.CUSTOMER_CODE, d.PRODUCT_CODE, i.SRL_NO,
            ${iso('i.DATE_FROM')} AS DATE_FROM, ${iso('i.DATE_TO')} AS DATE_TO
       FROM INCENTIVE_DETAIL d
       JOIN INCENTIVE i ON i.BRNCH = d.BRNCH AND i.SRL_NO = d.SRL_NO
      WHERE d.BRNCH = :b AND d.SRL_NO <> :n AND NVL(i.DOC_STATUS, 'COMMITTED') = 'COMMITTED'
        AND i.DATE_FROM <= TO_DATE(:dt, 'YYYY-MM-DD') AND i.DATE_TO >= TO_DATE(:df, 'YYYY-MM-DD')`,
    { b: s.brnch, n: Number(s.srlNo), df: s.dateFrom, dt: s.dateTo },
  );
  const paid = new Map();
  for (const r of rows)
    if (periodsOverlap(s, { dateFrom: r.DATE_FROM, dateTo: r.DATE_TO }))
      paid.set(`${r.CUSTOMER_CODE}|${r.PRODUCT_CODE}`, String(r.SRL_NO));
  return paid;
}

/** Preview of a scheme's run: per customer qty, rate, amount; `paidBy` marks BR-INC-03 clashes. */
export async function preview(tx, brnch, srlNo) {
  const s = await getScheme(tx, brnch, srlNo);
  const run = incentiveRun(await dispatched(tx, s), s.products);
  const paid = await alreadyPaid(tx, s);
  const customers = run.customers.map((c) => ({
    ...c,
    lines: c.lines.map((l) => ({
      ...l,
      paidBy: paid.get(`${c.customerCode}|${l.productCode}`) ?? null,
    })),
  }));
  return { scheme: s, ...run, customers };
}

/** Commit (incentive.commit, BR-INC-01/03): detail rows + one DRAFT credit note per customer. */
export async function commit(tx, actor, brnch, srlNo, rowVer) {
  const s = await getScheme(tx, brnch, srlNo, { forUpdate: true });
  if (s.rowVer !== rowVer) throw Errors.versionConflict();
  if (s.status !== 'DRAFT')
    throw Errors.invalidState(`Scheme ${srlNo} is ${s.status}: only a draft can be committed`);
  const run = incentiveRun(await dispatched(tx, s), s.products);
  if (!run.customers.length)
    throw Errors.rule('BR-INC-01', 'No invoiced quantity in this period, range and products');
  const paid = await alreadyPaid(tx, s);
  const clashes = run.customers.flatMap((c) =>
    c.lines
      .filter((l) => paid.has(`${c.customerCode}|${l.productCode}`))
      .map(
        (l) =>
          `${c.customerCode} ${l.productCode} (scheme ${paid.get(`${c.customerCode}|${l.productCode}`)})`,
      ),
  );
  if (clashes.length)
    throw Errors.rule(
      'BR-INC-03',
      `Already paid for an overlapping period: ${clashes.slice(0, 10).join(', ')}${clashes.length > 10 ? ' …' : ''}`,
      { clashes },
    );

  const noteType = await new SettingsReader(tx).get(brnch, 'NOTE_TYPE_INCENTIVE');
  const today = businessDate(actor.now);
  let srNo = 0;
  const notes = [];
  for (const c of run.customers) {
    for (const l of c.lines) {
      srNo += 1;
      await tx.exec(
        `INSERT INTO INCENTIVE_DETAIL (SRL_NO, SR_NO, CUSTOMER_CODE, PRODUCT_CODE, QUANTITY, RATE, AMOUNT,
           ACTUAL_QTY, COMPC, BRNCH)
         VALUES (:n, :sr, :c, :p, :q, :r, :a, :q, 1, :b)`,
        {
          n: Number(srlNo),
          sr: srNo,
          c: c.customerCode,
          p: l.productCode,
          q: dec(l.qtyTon).toDecimalPlaces(2).toFixed(2), // legacy column NUMBER(8,2)
          r: l.rate,
          a: l.amount,
          b: brnch,
        },
      );
    }
    const note = await createNote(
      tx,
      actor,
      brnch,
      {
        kind: 'C',
        noteType,
        customerCode: c.customerCode,
        date: today,
        remarks: `Incentive ${runTag(srlNo)}${s.memoNo ? ` (${s.memoNo})` : ''}: ${s.dateFrom} to ${s.dateTo}`,
        invoiceId: null,
        lines: c.lines.map((l) => ({
          particular: `Incentive ${l.productCode} ${l.qtyTon} t @ ${formatAmount(l.rate)}`.slice(
            0,
            60,
          ),
          amount: l.amount,
          whtPct: null,
        })),
      },
      { sourceRun: runTag(srlNo) },
    );
    notes.push(note.srlNo);
  }
  const n = await tx.exec(
    `UPDATE INCENTIVE SET DOC_STATUS = 'COMMITTED', TOTAL = :t, INCENTIVE = :t, ROW_VER = ROW_VER + 1,
       UPDATED_BY = :u, UPDATED_ON = :now
     WHERE BRNCH = :b AND SRL_NO = :n AND ROW_VER = :rv`,
    { t: run.amount, u: actor.usrid, now: actor.now, b: brnch, n: Number(srlNo), rv: rowVer },
  );
  if (n !== 1) throw Errors.versionConflict();
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: key(brnch, srlNo),
    action: 'COMMIT',
    brnch,
    newValues: { amount: run.amount, qtyTon: run.qtyTon, customers: run.customers.length, notes },
  });
  return getScheme(tx, brnch, srlNo);
}

/** Cancel a DRAFT scheme (the number stays used). */
export async function cancelScheme(tx, actor, brnch, srlNo, rowVer, reason) {
  const s = await getScheme(tx, brnch, srlNo, { forUpdate: true });
  if (s.rowVer !== rowVer) throw Errors.versionConflict();
  if (s.status !== 'DRAFT')
    throw Errors.invalidState(
      `Scheme ${srlNo} is ${s.status}: a committed run is undone by cancelling or reversing its notes`,
    );
  await tx.exec(
    `UPDATE INCENTIVE SET DOC_STATUS = 'CANCELLED', CANCEL_REASON = :r, CANCELLED_BY = :u,
       CANCELLED_ON = :now, ROW_VER = ROW_VER + 1, UPDATED_BY = :u, UPDATED_ON = :now
     WHERE BRNCH = :b AND SRL_NO = :n`,
    { r: reason.slice(0, 500), u: actor.usrid, now: actor.now, b: brnch, n: Number(srlNo) },
  );
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: key(brnch, srlNo),
    action: 'CANCEL',
    brnch,
    reason,
  });
  return getScheme(tx, brnch, srlNo);
}
