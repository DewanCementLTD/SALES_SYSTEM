// Cancellation documents (PRD 4.14, TASKS P2-08). Every DO/OC cancellation writes an order
// cancellation advice (ORDER_CANCEL_MASTER/DETAIL, number DOC_SEQUENCE OCA) and every bounced or
// cancelled BRV a receipt cancellation advice (RECEIPT_CANCEL_MASTER/DETAIL, number RCX as
// 'YYYY-NNNN', legacy CANCEL_TYPE 'B' = bounce; 'C' = cancelled before verification). Written in
// the same transaction as the cancellation.
import { businessDate, dec, fiscalYearOf } from '@dcl/shared';
import { branchFilter } from '../../lib/branch-scope.js';
import { paginate } from '../../lib/oracle/paginate.js';
import { nextNumber } from '../numbering/service.js';

const iso = (d) => (d ? businessDate(d) : null);
const n2 = (v) => (v === null || v === undefined ? null : dec(v).toFixed(2));
const today = (now) => new Date(`${businessDate(now)}T00:00:00+05:00`);

/**
 * @param {import('../../lib/oracle/db.js').Tx} tx
 * @param {{ usrid: string, now: Date }} actor
 * @param {{ brnch: number, customerCode: string, lines: { doNo: string, doType: string, productCode: string|null,
 *   issueDate: string|null, qtyTon: string, ocNo: string|null, amount: string }[] }} advice
 */
export async function writeOrderAdvice(tx, actor, { brnch, customerCode, lines }) {
  if (!lines.length) return null;
  const year = fiscalYearOf(actor.now);
  const no = await nextNumber(tx, { brnch, year, docType: 'OCA' });
  const total = lines.reduce((s, l) => s.plus(dec(l.amount ?? 0)), dec(0)).toFixed(2);
  await tx.exec(
    `INSERT INTO ORDER_CANCEL_MASTER (OC_ADVISE_NO, OC_ADVISE_DATE, CUSTOMER_CODE, ENTER_BY, ENTER_DATE, YEAR,
       AMOUNT, COMPC, BRNCH, DOC_STATUS, ROW_VER, CREATED_BY, CREATED_ON)
     VALUES (:n, :d, :c, :u10, :now, :y, :amt, 1, :b, 'POSTED', 1, :u, :now)`,
    {
      n: no,
      d: today(actor.now),
      c: customerCode,
      u10: actor.usrid.slice(0, 10),
      u: actor.usrid,
      now: actor.now,
      y: year,
      amt: total,
      b: brnch,
    },
  );
  let sr = 0;
  for (const l of lines) {
    sr += 1;
    await tx.exec(
      `INSERT INTO ORDER_CANCEL_DETAIL (OC_ADVISE_NO, SR_NO, DO_NO, PRODUCT_CODE, DATE_OF_ISSUE, QUANTITY, DO_DATE,
         OC_NO, DOC_TYPE, AMOUNT, COMPC, BRNCH)
       VALUES (:n, :sr, :do, :p, :di, :q, :di, :oc, :t, :amt, 1, :b)`,
      {
        n: no,
        sr,
        do: l.doNo,
        p: l.productCode,
        di: l.issueDate ? new Date(`${l.issueDate}T00:00:00+05:00`) : null,
        q: dec(l.qtyTon).toFixed(2),
        oc: l.ocNo,
        t: l.doType,
        amt: l.amount,
        b: brnch,
      },
    );
  }
  return no;
}

/**
 * @param {{ brnch: number, customerCode: string, receiptNo: string, amount: string, kind: 'B'|'C', remarks?: string }} advice
 */
export async function writeReceiptAdvice(
  tx,
  actor,
  { brnch, customerCode, receiptNo, amount, kind, remarks },
) {
  const year = fiscalYearOf(actor.now);
  const seq = await nextNumber(tx, { brnch, year, docType: 'RCX' });
  const no = `${year}-${String(seq).padStart(4, '0')}`;
  await tx.exec(
    `INSERT INTO RECEIPT_CANCEL_MASTER (CANCEL_NO, MEMO_DATE, CUSTOMER_CODE, CASH_CHEQ_CD, CANCEL_TYPE, RETURN_CHARGES,
       AMOUNT, REMARKS, ENTER_BY, ENTER_DATE, POST, COMPC, BRNCH)
     VALUES (:n, :d, :c, 'Q', :k, 0, :amt, :rem, :u10, :now, 'N', 1, :b)`,
    {
      n: no,
      d: today(actor.now),
      c: customerCode,
      k: kind,
      amt: amount,
      rem: remarks ? remarks.slice(0, 60) : null,
      u10: actor.usrid.slice(0, 10),
      now: actor.now,
      b: brnch,
    },
  );
  await tx.exec(
    `INSERT INTO RECEIPT_CANCEL_DETAIL (CANCEL_NO, CASH_CHEQ_CD, SRL_NO, RECEIPT_NO, RECEIPT_SRL, AMOUNT, COMPC, BRNCH)
     VALUES (:n, 'Q', 1, :r, :r, :amt, 1, :b)`,
    { n: no, r: receiptNo, amt: amount, b: brnch },
  );
  return no;
}

/** Order cancellation advices with their lines (newest first). */
export async function listOrderAdvices(tx, o) {
  const bf = branchFilter('m.BRNCH', o.branches);
  const page = await paginate(tx, {
    sql: `SELECT m.BRNCH, m.OC_ADVISE_NO, m.OC_ADVISE_DATE, m.CUSTOMER_CODE, c.CUSTOMER_NAME, m.AMOUNT,
                 NVL(m.CREATED_BY, m.ENTER_BY) AS CREATED_BY,
                 (SELECT COUNT(*) FROM ORDER_CANCEL_DETAIL d WHERE d.BRNCH = m.BRNCH AND d.OC_ADVISE_NO = m.OC_ADVISE_NO) AS LINES,
                 (SELECT SUM(d.QUANTITY) FROM ORDER_CANCEL_DETAIL d WHERE d.BRNCH = m.BRNCH AND d.OC_ADVISE_NO = m.OC_ADVISE_NO) AS QTY
            FROM ORDER_CANCEL_MASTER m
            LEFT JOIN CUSTOMER_INFO c ON c.BRNCH = m.BRNCH AND c.CUSTOMER_CODE = m.CUSTOMER_CODE
           WHERE ${bf.sql}
           ORDER BY m.OC_ADVISE_DATE DESC NULLS LAST, m.OC_ADVISE_NO DESC, m.BRNCH`,
    binds: bf.binds,
    page: o.page,
    pageSize: o.pageSize,
  });
  return {
    ...page,
    items: page.items.map((r) => ({
      kind: 'ORDER',
      brnch: Number(r.BRNCH),
      adviceNo: String(r.OC_ADVISE_NO),
      date: iso(r.OC_ADVISE_DATE),
      customerCode: r.CUSTOMER_CODE,
      customerName: r.CUSTOMER_NAME ?? null,
      amount: n2(r.AMOUNT),
      qtyTon: r.QTY === null ? null : dec(r.QTY).toFixed(2),
      lines: Number(r.LINES),
      createdBy: r.CREATED_BY ?? null,
    })),
  };
}

export async function listReceiptAdvices(tx, o) {
  const bf = branchFilter('m.BRNCH', o.branches);
  const page = await paginate(tx, {
    sql: `SELECT m.BRNCH, m.CANCEL_NO, m.MEMO_DATE, m.CUSTOMER_CODE, c.CUSTOMER_NAME, m.CANCEL_TYPE, m.AMOUNT,
                 m.REMARKS, m.ENTER_BY,
                 (SELECT MAX(TO_CHAR(d.RECEIPT_SRL)) FROM RECEIPT_CANCEL_DETAIL d WHERE d.BRNCH = m.BRNCH AND d.CANCEL_NO = m.CANCEL_NO) AS RECEIPT
            FROM RECEIPT_CANCEL_MASTER m
            LEFT JOIN CUSTOMER_INFO c ON c.BRNCH = m.BRNCH AND c.CUSTOMER_CODE = m.CUSTOMER_CODE
           WHERE ${bf.sql}
           ORDER BY m.MEMO_DATE DESC NULLS LAST, m.CANCEL_NO DESC, m.BRNCH`,
    binds: bf.binds,
    page: o.page,
    pageSize: o.pageSize,
  });
  return {
    ...page,
    items: page.items.map((r) => ({
      kind: r.CANCEL_TYPE === 'B' ? 'BOUNCE' : 'RECEIPT',
      brnch: Number(r.BRNCH),
      adviceNo: r.CANCEL_NO,
      date: iso(r.MEMO_DATE),
      customerCode: r.CUSTOMER_CODE,
      customerName: r.CUSTOMER_NAME ?? null,
      amount: n2(r.AMOUNT),
      receiptNo: r.RECEIPT ?? null,
      remarks: r.REMARKS ?? null,
      createdBy: r.ENTER_BY ?? null,
    })),
  };
}
