// SQL for BRVs (CASH_CHEQUE_RECEIPTS, TASKS P2-04). Branch-scoped; values bound.
import { BRV_CASH_CHEQ_CD, BRV_RETURN_CD, businessDate, dec } from '@dcl/shared';
import { branchFilter } from '../../lib/branch-scope.js';
import { orderBy, paginate } from '../../lib/oracle/paginate.js';

const toDate = (iso) => (iso ? new Date(`${iso}T00:00:00+05:00`) : null);
const iso = (d) => (d ? businessDate(d) : null);
const n2 = (v) => (v === null || v === undefined ? null : dec(v).toFixed(2));

/** Legacy rows have no DOC_STATUS: RETURN_CD R = bounced, C = cleared, else verified (posted). */
export const BRV_STATUS_SQL = `NVL(r.DOC_STATUS, CASE r.RETURN_CD WHEN 'R' THEN 'BOUNCED'
  WHEN 'C' THEN 'CLEARED' ELSE 'VERIFIED' END)`;

const COLS = `r.BRNCH, TO_CHAR(r.RECEIPT_NO) AS RECEIPT_NO, r.CASH_CHEQ_CD, r.YEAR, r.CR_DATE,
  r.CUSTOMER_CODE, c.CUSTOMER_NAME, r.INST_CODE, it.INST_DESC, r.CAT_CODE, r.BANK_CODE, bd.BANK_NAME,
  r.CHEQUE_NO, r.CHEQUE_DATE, r.BANK, cb.BANK_DESC AS DEP_BANK, cb.ABBR AS DEP_ABBR, r.ACCOUNT_NO,
  r.AMOUNT, r.SALES_TAX, r.TAX, r.FREIGHT, r.FUND_FROM, r.TRANS_NAME, r.DEPOSITOR, r.CITY, r.REM,
  r.CLEAR_DATE, r.RETURN_DATE, r.APPLIED_AMT, ${BRV_STATUS_SQL} AS STATUS, r.ROW_VER,
  NVL(r.CREATED_BY, r.ENTER_BY) AS CREATED_BY, NVL(r.CREATED_ON, r.ENTER_DATE) AS CREATED_ON,
  r.VERIFIED_BY, r.VERIFIED_ON, r.VERIFY_METHOD, r.VERIFY_REF, r.VERIFY_REMARKS, r.BOUNCED_BY,
  r.BOUNCED_ON, r.BOUNCE_REASON, r.CANCEL_REASON, r.CANCELLED_BY, r.CANCELLED_ON`;
const FROM = `CASH_CHEQUE_RECEIPTS r
  LEFT JOIN CUSTOMER_INFO c ON c.BRNCH = r.BRNCH AND c.CUSTOMER_CODE = r.CUSTOMER_CODE
  LEFT JOIN INSTRUMENT_TYPE it ON it.BRNCH = r.BRNCH AND it.INST_CODE = r.INST_CODE
  LEFT JOIN BANK_DESC bd ON bd.BRNCH = r.BRNCH AND bd.BANK_CODE = r.BANK_CODE
  LEFT JOIN COMPANY_BANK cb ON cb.BRNCH = r.BRNCH AND cb.BANK_CODE = r.BANK`;

export function mapBrv(r) {
  return {
    brnch: Number(r.BRNCH),
    receiptNo: r.RECEIPT_NO,
    cashCheqCd: r.CASH_CHEQ_CD,
    year: r.YEAR === null ? null : Number(r.YEAR),
    brvDate: iso(r.CR_DATE),
    customerCode: r.CUSTOMER_CODE,
    customerName: r.CUSTOMER_NAME ?? null,
    instCode: r.INST_CODE ?? null,
    instrument: r.INST_DESC ?? null,
    category: r.CAT_CODE ?? null,
    bankCode: r.BANK_CODE ?? null,
    bankName: r.BANK_NAME ?? null,
    chequeNo: r.CHEQUE_NO ?? null,
    chequeDate: iso(r.CHEQUE_DATE),
    depositAccount: r.BANK ?? null,
    depositBank: r.DEP_BANK ?? r.ACCOUNT_NO ?? null,
    depositShort: r.DEP_ABBR ?? r.ACCOUNT_NO ?? null,
    amount: n2(r.AMOUNT),
    salesTax: n2(r.SALES_TAX),
    tax: n2(r.TAX),
    freight: n2(r.FREIGHT),
    fundFrom: r.FUND_FROM ?? null,
    transporter: r.TRANS_NAME ?? null,
    depositor: r.DEPOSITOR ?? null,
    city: r.CITY ?? null,
    remarks: r.REM ?? null,
    clearDate: iso(r.CLEAR_DATE),
    returnDate: iso(r.RETURN_DATE),
    appliedAmount: n2(r.APPLIED_AMT) ?? '0.00',
    status: r.STATUS,
    rowVer: Number(r.ROW_VER),
    createdBy: r.CREATED_BY ?? null,
    createdOn: r.CREATED_ON ?? null,
    verifiedBy: r.VERIFIED_BY ?? null,
    verifiedOn: r.VERIFIED_ON ?? null,
    verifyMethod: r.VERIFY_METHOD ?? null,
    verifyRef: r.VERIFY_REF ?? null,
    verifyRemarks: r.VERIFY_REMARKS ?? null,
    bouncedBy: r.BOUNCED_BY ?? null,
    bouncedOn: r.BOUNCED_ON ?? null,
    bounceReason: r.BOUNCE_REASON ?? null,
    cancelReason: r.CANCEL_REASON ?? null,
    cancelledBy: r.CANCELLED_BY ?? null,
    cancelledOn: r.CANCELLED_ON ?? null,
  };
}

const SORTABLE = {
  receiptNo: 'r.RECEIPT_NO',
  brvDate: 'r.CR_DATE',
  amount: 'r.AMOUNT',
  customerCode: 'r.CUSTOMER_CODE',
};

/**
 * @param {{ branches: number[], status?: string, customer?: string, bank?: string, from?: string,
 *   to?: string, q?: string, page?: number, pageSize?: number, sort?: string, oldestFirst?: boolean }} o
 */
export async function list(tx, o) {
  const bf = branchFilter('r.BRNCH', o.branches);
  const where = [bf.sql, `r.CASH_CHEQ_CD = '${BRV_CASH_CHEQ_CD}'`];
  const binds = { ...bf.binds };
  if (o.status) {
    where.push(`${BRV_STATUS_SQL} = :st`);
    binds.st = o.status;
  }
  if (o.customer) {
    where.push('r.CUSTOMER_CODE = :cu');
    binds.cu = o.customer;
  }
  if (o.bank) {
    where.push('(r.BANK = :bk OR r.BANK_CODE = :bk)');
    binds.bk = o.bank;
  }
  if (o.from) {
    where.push('r.CR_DATE >= :df');
    binds.df = toDate(o.from);
  }
  if (o.to) {
    where.push('r.CR_DATE < :dt + 1');
    binds.dt = toDate(o.to);
  }
  if (o.q) {
    where.push(
      `(TO_CHAR(r.RECEIPT_NO) LIKE :q ESCAPE '\\' OR r.CUSTOMER_CODE LIKE :q ESCAPE '\\'
        OR UPPER(c.CUSTOMER_NAME) LIKE :q ESCAPE '\\' OR UPPER(r.CHEQUE_NO) LIKE :q ESCAPE '\\')`,
    );
    binds.q = `%${o.q.toUpperCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  }
  const fallback = o.oldestFirst
    ? 'r.CR_DATE, r.RECEIPT_NO'
    : 'r.CR_DATE DESC NULLS LAST, r.RECEIPT_NO DESC';
  const page = await paginate(tx, {
    sql: `SELECT ${COLS} FROM ${FROM} WHERE ${where.join(' AND ')}
          ${orderBy(o.sort, SORTABLE, fallback, 'r.BRNCH, r.RECEIPT_NO')}`,
    binds,
    page: o.page,
    pageSize: o.pageSize,
  });
  return { ...page, items: page.items.map(mapBrv) };
}

export async function get(tx, brnch, receiptNo, { forUpdate = false } = {}) {
  const key = { b: brnch, n: receiptNo, cd: BRV_CASH_CHEQ_CD };
  if (forUpdate) {
    const l = await tx.one(
      'SELECT RECEIPT_NO FROM CASH_CHEQUE_RECEIPTS WHERE BRNCH = :b AND RECEIPT_NO = :n AND CASH_CHEQ_CD = :cd FOR UPDATE',
      key,
    );
    if (!l) return null;
  }
  const r = await tx.one(
    `SELECT ${COLS} FROM ${FROM} WHERE r.BRNCH = :b AND r.RECEIPT_NO = :n AND r.CASH_CHEQ_CD = :cd`,
    key,
  );
  return r ? mapBrv(r) : null;
}

function bodyBinds(b, depositAbbr) {
  return {
    cr: toDate(b.brvDate),
    cu: b.customerCode,
    inst: b.instCode,
    cat: b.category ?? null,
    bank: b.bankCode ?? null,
    chq: b.chequeNo ?? null,
    chqd: toDate(b.chequeDate ?? null),
    dep: b.depositAccount,
    acc: depositAbbr,
    amt: b.amount,
    st: b.salesTax ?? null,
    tax: b.tax ?? null,
    fr: b.freight ?? null,
    ff: b.fundFrom ?? null,
    tr: b.transporter ?? null,
    dp: b.depositor ?? null,
    city: b.city ?? null,
    rem: b.remarks ?? null,
  };
}

export async function insert(tx, { brnch, receiptNo, year, body, depositAbbr, usrid, now }) {
  await tx.exec(
    `INSERT INTO CASH_CHEQUE_RECEIPTS (RECEIPT_NO, CASH_CHEQ_CD, BRNCH, COMPC, YEAR, CR_DATE,
       CUSTOMER_CODE, INST_CODE, CAT_CODE, BANK_CODE, CHEQUE_NO, CHEQUE_DATE, BANK, ACCOUNT_NO, AMOUNT,
       SALES_TAX, TAX, FREIGHT, FUND_FROM, TRANS_NAME, DEPOSITOR, CITY, REM, RETURN_CD, DOC_STATUS,
       ROW_VER, APPLIED_AMT, CREATED_BY, CREATED_ON, ENTER_BY, ENTER_DATE, USRID)
     VALUES (:n, :cd, :b, 1, :y, :cr, :cu, :inst, :cat, :bank, :chq, :chqd, :dep, :acc, :amt, :st,
       :tax, :fr, :ff, :tr, :dp, :city, :rem, 'P', 'ENTERED', 1, 0, :usr, :now, :usr10, :now, :usr10)`,
    {
      n: receiptNo,
      cd: BRV_CASH_CHEQ_CD,
      b: brnch,
      y: year,
      ...bodyBinds(body, depositAbbr),
      usr: usrid,
      usr10: usrid.slice(0, 10),
      now,
    },
  );
}

export async function update(tx, { brnch, receiptNo, rowVer, body, depositAbbr, usrid, now }) {
  return tx.exec(
    `UPDATE CASH_CHEQUE_RECEIPTS SET CR_DATE = :cr, CUSTOMER_CODE = :cu, INST_CODE = :inst,
       CAT_CODE = :cat, BANK_CODE = :bank, CHEQUE_NO = :chq, CHEQUE_DATE = :chqd, BANK = :dep,
       ACCOUNT_NO = :acc, AMOUNT = :amt, SALES_TAX = :st, TAX = :tax, FREIGHT = :fr, FUND_FROM = :ff,
       TRANS_NAME = :tr, DEPOSITOR = :dp, CITY = :city, REM = :rem, ROW_VER = ROW_VER + 1,
       UPDATED_BY = :usr, UPDATED_ON = :now
     WHERE BRNCH = :b AND RECEIPT_NO = :n AND CASH_CHEQ_CD = :cd AND ROW_VER = :rv`,
    {
      b: brnch,
      n: receiptNo,
      cd: BRV_CASH_CHEQ_CD,
      rv: rowVer,
      ...bodyBinds(body, depositAbbr),
      usr: usrid,
      now,
    },
  );
}

/** Status change with the legacy RETURN_CD kept in sync; `sets` = extra column assignments. */
export async function setStatus(tx, { brnch, receiptNo, rowVer, status, usrid, now, sets = {} }) {
  const cols = Object.keys(sets);
  const binds = {
    b: brnch,
    n: receiptNo,
    cd: BRV_CASH_CHEQ_CD,
    rv: rowVer,
    st: status,
    rc: BRV_RETURN_CD[status],
    usr: usrid,
    now,
  };
  cols.forEach((c, i) => {
    binds[`x${i}`] = sets[c];
  });
  return tx.exec(
    `UPDATE CASH_CHEQUE_RECEIPTS SET DOC_STATUS = :st, RETURN_CD = :rc, ROW_VER = ROW_VER + 1,
       UPDATED_BY = :usr, UPDATED_ON = :now${cols.map((c, i) => `, ${c} = :x${i}`).join('')}
     WHERE BRNCH = :b AND RECEIPT_NO = :n AND CASH_CHEQ_CD = :cd AND ROW_VER = :rv`,
    binds,
  );
}

/** OCs funded by a BRV (ORDER_CONFIRM_BRV) with their status, for the bounce impact list. */
export async function linkedOcs(tx, brnch, receiptNo) {
  const rows = await tx.many(
    `SELECT TO_CHAR(l.ORDER_NO) AS ORDER_NO, l.AMOUNT,
            NVL(o.DOC_STATUS, CASE WHEN o.CANCEL_CODE = 'Y' THEN 'CANCELLED'
              WHEN o.APPROVED = 'Y' THEN 'CONFIRMED' ELSE 'DRAFT' END) AS STATUS
       FROM ORDER_CONFIRM_BRV l
       LEFT JOIN ORDER_CONFIRM o ON o.BRNCH = l.BRNCH AND o.ORDER_NO = l.ORDER_NO
      WHERE l.BRNCH = :b AND l.RECEIPT_NO = :n AND NVL(l.AMOUNT, 0) > 0
      ORDER BY l.ORDER_NO`,
    { b: brnch, n: receiptNo },
  );
  return rows.map((r) => ({ ocNo: r.ORDER_NO, amount: n2(r.AMOUNT), status: r.STATUS }));
}

export { toDate };
