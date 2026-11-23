// SQL for OCs (ORDER_CONFIRM / ORDER_CONFIRM_DETAIL / ORDER_CONFIRM_BRV, TASKS P2-03).
// Branch-scoped; values bound. Schedule lines and BRV links are never deleted: a removed line or
// link keeps its row with QUANTITY / AMOUNT 0.
import { businessDate, dec } from '@dcl/shared';
import { branchFilter } from '../../lib/branch-scope.js';
import { orderBy, paginate } from '../../lib/oracle/paginate.js';
import { OC_STATUS_SQL } from './builder.js';

const toDate = (iso) => (iso ? new Date(`${iso}T00:00:00+05:00`) : null);
const iso = (d) => (d ? businessDate(d) : null);
const n2 = (v) => (v === null || v === undefined ? null : dec(v).toFixed(2));

const COLS = `o.BRNCH, TO_CHAR(o.ORDER_NO) AS ORDER_NO, TO_CHAR(o.SRF_NO) AS SRF_NO, o.YEAR, o.ORDER_DATE,
  o.CUSTOMER_CODE, c.CUSTOMER_NAME, o.PRODUCT_CODE, o.QUANTITY, o.AREA_CODE, o.DEST_GEO_CODE,
  NVL(g.CITY_NAME, g.AREA_NAME) AS DEST_NAME, o.RETAIL_PRICE, o.TRADE_DISC, o.GROSS_PRICE, o.SALES_TAX,
  o.CED, o.CONS_PRICE, o.EXPENSE, o.DISCOUNT, o.NET_BOOK_PRICE, o.TOT_NET, o.OC_VALUE, o.REMARKS,
  o.SALES_TAX_TYPE, o.PRICE_OVERRIDE, o.MASTER_PRICES, ${OC_STATUS_SQL} AS STATUS, o.ROW_VER,
  NVL(o.CREATED_BY, o.ENTER_BY) AS CREATED_BY, NVL(o.CREATED_ON, o.ENTER_DATE) AS CREATED_ON,
  o.UPDATED_BY, o.UPDATED_ON, o.REVIEWED_BY, o.APPROVED_BY, o.APPROVED_ON, o.CONFIRMED_BY,
  o.CONFIRMED_ON, o.OVERRIDE_REQ_ID, o.CANCEL_REASON, o.CANCELLED_BY, o.CANCELLED_ON`;
const FROM = `ORDER_CONFIRM o
  LEFT JOIN CUSTOMER_INFO c ON c.BRNCH = o.BRNCH AND c.CUSTOMER_CODE = o.CUSTOMER_CODE
  LEFT JOIN GEO_HIERARCHY g ON g.BRNCH = o.BRNCH AND g.GEO_CODE = o.DEST_GEO_CODE`;

export function mapOc(r) {
  let master = null;
  try {
    master = r.MASTER_PRICES ? JSON.parse(r.MASTER_PRICES) : null;
  } catch {
    master = null;
  }
  return {
    brnch: Number(r.BRNCH),
    ocNo: r.ORDER_NO,
    srfNo: r.SRF_NO ?? null,
    year: r.YEAR === null ? null : Number(r.YEAR),
    orderDate: iso(r.ORDER_DATE),
    customerCode: r.CUSTOMER_CODE,
    customerName: r.CUSTOMER_NAME ?? null,
    productCode: r.PRODUCT_CODE,
    qtyTon: n2(r.QUANTITY),
    priceCode: r.AREA_CODE ?? null,
    destGeoCode: r.DEST_GEO_CODE ?? null,
    destName: r.DEST_NAME ?? null,
    prices: {
      retailPrice: n2(r.RETAIL_PRICE) ?? '0.00',
      tradeDisc: n2(r.TRADE_DISC) ?? '0.00',
      salesTax: n2(r.SALES_TAX) ?? '0.00',
      fed: n2(r.CED) ?? '0.00',
      consPrice: n2(r.CONS_PRICE) ?? '0.00',
      expense: n2(r.EXPENSE) ?? '0.00',
      discount: n2(r.DISCOUNT) ?? '0.00',
    },
    netPrice: n2(r.NET_BOOK_PRICE) ?? '0.00',
    value: n2(r.OC_VALUE ?? r.TOT_NET) ?? '0.00',
    remarks: r.REMARKS ?? null,
    salesTaxType: r.SALES_TAX_TYPE ?? null,
    priceOverride: r.PRICE_OVERRIDE ?? 'N',
    masterPrices: master,
    status: r.STATUS,
    rowVer: Number(r.ROW_VER),
    createdBy: r.CREATED_BY ?? null,
    createdOn: r.CREATED_ON ?? null,
    updatedBy: r.UPDATED_BY ?? null,
    updatedOn: r.UPDATED_ON ?? null,
    reviewedBy: r.REVIEWED_BY ?? null,
    approvedBy: r.APPROVED_BY ?? null,
    approvedOn: r.APPROVED_ON ?? null,
    confirmedBy: r.CONFIRMED_BY ?? null,
    confirmedOn: r.CONFIRMED_ON ?? null,
    overrideReqId: r.OVERRIDE_REQ_ID === null ? null : Number(r.OVERRIDE_REQ_ID),
    cancelReason: r.CANCEL_REASON ?? null,
    cancelledBy: r.CANCELLED_BY ?? null,
    cancelledOn: r.CANCELLED_ON ?? null,
  };
}

const SORTABLE = { ocNo: 'o.ORDER_NO', orderDate: 'o.ORDER_DATE', value: 'o.OC_VALUE' };

export async function list(tx, o) {
  const bf = branchFilter('o.BRNCH', o.branches);
  const where = [bf.sql];
  const binds = { ...bf.binds };
  if (o.status) {
    where.push(`${OC_STATUS_SQL} = :st`);
    binds.st = o.status;
  }
  if (o.customer) {
    where.push('o.CUSTOMER_CODE = :cu');
    binds.cu = o.customer;
  }
  if (o.from) {
    where.push('o.ORDER_DATE >= :df');
    binds.df = toDate(o.from);
  }
  if (o.to) {
    where.push('o.ORDER_DATE < :dt + 1');
    binds.dt = toDate(o.to);
  }
  if (o.q) {
    where.push(
      `(TO_CHAR(o.ORDER_NO) LIKE :q ESCAPE '\\' OR TO_CHAR(o.SRF_NO) LIKE :q ESCAPE '\\'
        OR o.CUSTOMER_CODE LIKE :q ESCAPE '\\' OR UPPER(c.CUSTOMER_NAME) LIKE :q ESCAPE '\\')`,
    );
    binds.q = `%${o.q.toUpperCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  }
  const page = await paginate(tx, {
    sql: `SELECT ${COLS} FROM ${FROM} WHERE ${where.join(' AND ')}
          ${orderBy(o.sort, SORTABLE, 'o.ORDER_DATE DESC NULLS LAST, o.ORDER_NO DESC', 'o.BRNCH, o.ORDER_NO')}`,
    binds,
    page: o.page,
    pageSize: o.pageSize,
  });
  return { ...page, items: page.items.map(mapOc) };
}

export async function get(tx, brnch, ocNo, { forUpdate = false } = {}) {
  if (forUpdate) {
    const l = await tx.one(
      'SELECT ORDER_NO FROM ORDER_CONFIRM WHERE BRNCH = :b AND ORDER_NO = :n FOR UPDATE',
      { b: brnch, n: ocNo },
    );
    if (!l) return null;
  }
  const r = await tx.one(`SELECT ${COLS} FROM ${FROM} WHERE o.BRNCH = :b AND o.ORDER_NO = :n`, {
    b: brnch,
    n: ocNo,
  });
  return r ? mapOc(r) : null;
}

export async function schedule(tx, brnch, ocNo) {
  const rows = await tx.many(
    `SELECT SR_NO, SCH_DATE, QUANTITY FROM ORDER_CONFIRM_DETAIL
      WHERE BRNCH = :b AND ORDER_NO = :n AND QUANTITY > 0 ORDER BY SR_NO`,
    { b: brnch, n: ocNo },
  );
  return rows.map((r) => ({
    srNo: Number(r.SR_NO),
    date: iso(r.SCH_DATE),
    qtyTon: n2(r.QUANTITY),
  }));
}

/** Write the schedule (update/insert given lines; lines no longer given get QUANTITY 0). */
export async function writeSchedule(tx, { brnch, ocNo, srfNo, orderDate, lines }) {
  const have = new Set(
    (
      await tx.many('SELECT SR_NO FROM ORDER_CONFIRM_DETAIL WHERE BRNCH = :b AND ORDER_NO = :n', {
        b: brnch,
        n: ocNo,
      })
    ).map((r) => Number(r.SR_NO)),
  );
  const given = new Set(lines.map((l) => l.srNo));
  for (const l of lines) {
    const binds = { b: brnch, n: ocNo, sr: l.srNo, d: toDate(l.date), q: l.qtyTon };
    if (have.has(l.srNo)) {
      await tx.exec(
        'UPDATE ORDER_CONFIRM_DETAIL SET SCH_DATE = :d, QUANTITY = :q WHERE BRNCH = :b AND ORDER_NO = :n AND SR_NO = :sr',
        binds,
      );
    } else {
      await tx.exec(
        `INSERT INTO ORDER_CONFIRM_DETAIL (SR_NO, ORDER_NO, SCH_DATE, QUANTITY, ORDER_DATE, SRF_NO, COMPC, BRNCH)
         VALUES (:sr, :n, :d, :q, :od, :srf, 1, :b)`,
        { ...binds, od: toDate(orderDate), srf: srfNo },
      );
    }
  }
  for (const no of have) {
    if (!given.has(no)) {
      await tx.exec(
        'UPDATE ORDER_CONFIRM_DETAIL SET QUANTITY = 0 WHERE BRNCH = :b AND ORDER_NO = :n AND SR_NO = :sr',
        { b: brnch, n: ocNo, sr: no },
      );
    }
  }
}

/** BRV links of an OC (amount > 0) with the BRV status and what is still free on the BRV. */
export async function brvLinks(tx, brnch, ocNo) {
  const rows = await tx.many(
    `SELECT l.SERNO, TO_CHAR(l.RECEIPT_NO) AS RECEIPT_NO, l.AMOUNT, l.CR_DATE, l.REM, r.CR_DATE AS BRV_DATE,
            r.AMOUNT AS BRV_AMOUNT, r.APPLIED_AMT, r.CHEQUE_NO,
            NVL(r.DOC_STATUS, CASE r.RETURN_CD WHEN 'R' THEN 'BOUNCED' WHEN 'C' THEN 'CLEARED' ELSE 'VERIFIED' END) AS BRV_STATUS
       FROM ORDER_CONFIRM_BRV l
       LEFT JOIN CASH_CHEQUE_RECEIPTS r ON r.BRNCH = l.BRNCH AND r.RECEIPT_NO = l.RECEIPT_NO AND r.CASH_CHEQ_CD = 'Q'
      WHERE l.BRNCH = :b AND l.ORDER_NO = :n AND NVL(l.AMOUNT, 0) > 0
      ORDER BY l.SERNO`,
    { b: brnch, n: ocNo },
  );
  return rows.map((r) => ({
    serno: Number(r.SERNO),
    receiptNo: r.RECEIPT_NO,
    amount: n2(r.AMOUNT),
    brvDate: iso(r.BRV_DATE ?? r.CR_DATE),
    brvAmount: n2(r.BRV_AMOUNT),
    chequeNo: r.CHEQUE_NO ?? null,
    brvStatus: r.BRV_STATUS,
    remarks: r.REM ?? null,
  }));
}

/** Verified/cleared BRVs of the customer with money not yet applied to OCs (BR-OC-05 grid). */
export async function linkableBrvs(tx, brnch, customerCode) {
  const rows = await tx.many(
    `SELECT TO_CHAR(r.RECEIPT_NO) AS RECEIPT_NO, r.CR_DATE, r.AMOUNT, NVL(r.APPLIED_AMT, 0) AS APPLIED,
            r.CHEQUE_NO, r.DOC_STATUS
       FROM CASH_CHEQUE_RECEIPTS r
      WHERE r.BRNCH = :b AND r.CUSTOMER_CODE = :c AND r.CASH_CHEQ_CD = 'Q'
        AND r.DOC_STATUS IN ('VERIFIED', 'CLEARED') AND r.AMOUNT > NVL(r.APPLIED_AMT, 0)
      ORDER BY r.CR_DATE, r.RECEIPT_NO`,
    { b: brnch, c: customerCode },
    { maxRows: 100 },
  );
  return rows.map((r) => ({
    receiptNo: r.RECEIPT_NO,
    brvDate: iso(r.CR_DATE),
    amount: n2(r.AMOUNT),
    free: dec(r.AMOUNT).minus(dec(r.APPLIED)).toFixed(2),
    chequeNo: r.CHEQUE_NO ?? null,
    status: r.DOC_STATUS,
  }));
}

/** DOs created by an OC. */
export async function dosOf(tx, brnch, ocNo) {
  const rows = await tx.many(
    `SELECT DO_TYPE, TO_CHAR(DEL_ORDER_NO) AS DO_NO, SR_NO, SCHED_DATE, DO_QUANTITY, DO_RATE, DO_VALUE,
            NVL(DISPATCHED_TON, NVL(DISPATCHED, 0)) AS DISPATCHED,
            NVL(DOC_STATUS, CASE WHEN CANCEL_CODE = 'Y' THEN 'CANCELLED' ELSE 'ISSUED' END) AS STATUS
       FROM DELIVERY_ORDER WHERE BRNCH = :b AND ORDER_NO = :n ORDER BY SR_NO, DEL_ORDER_NO`,
    { b: brnch, n: ocNo },
  );
  return rows.map((r) => ({
    doType: r.DO_TYPE,
    doNo: r.DO_NO,
    srNo: r.SR_NO === null ? null : Number(r.SR_NO),
    schedDate: iso(r.SCHED_DATE),
    qtyTon: dec(r.DO_QUANTITY ?? 0).toFixed(3),
    rate: r.DO_RATE === null ? null : dec(r.DO_RATE).toFixed(2),
    value: n2(r.DO_VALUE),
    dispatchedTon: dec(r.DISPATCHED).toFixed(3),
    status: r.STATUS,
  }));
}

export { toDate };
