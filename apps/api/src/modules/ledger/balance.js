// BalanceService (BUSINESS_RULES §6, TASKS P1-08). The only balance used for OC confirm, permit
// issue and DO re-pricing (BR-BAL-01). Callers that spend the balance lock the customer first
// (lockCustomer, BR-BAL-02) and save in the same transaction.
import {
  CREDIT_TYPE_COLUMNS,
  CREDIT_TYPES,
  availableBalance,
  businessDate,
  dec,
  openValue,
  shortfall,
  unusedCredit,
} from '@dcl/shared';
import { Errors } from '../../lib/errors.js';
import * as ledger from './service.js';

/** DO states whose undispatched part is an open commitment. */
export const OPEN_DO_STATES = ['ISSUED', 'PARTLY_DISPATCHED', 'ON_HOLD'];
/** Permit states whose undispatched area lines are open commitments. */
export const OPEN_PERMIT_STATES = ['ISSUED', 'PARTLY_DISPATCHED'];

/** BR-BAL-02: lock the customer row for the rest of the transaction. */
export async function lockCustomer(tx, brnch, code) {
  const r = await tx.one(
    'SELECT CUSTOMER_CODE FROM CUSTOMER_INFO WHERE BRNCH = :b AND CUSTOMER_CODE = :c FOR UPDATE',
    { b: brnch, c: code },
  );
  if (!r) throw Errors.notFound('Customer');
}

const inList = (prefix, values) => ({
  sql: values.map((_, i) => `:${prefix}${i}`).join(', '),
  binds: Object.fromEntries(values.map((v, i) => [`${prefix}${i}`, v])),
});

/** Open commitments by document (BR-BAL-05). Legacy rows without DOC_STATUS are not counted. */
export async function openCommitments(tx, brnch, code) {
  const ds = inList('ds', OPEN_DO_STATES);
  const dos = await tx.many(
    `SELECT DO_TYPE, DEL_ORDER_NO, ORDER_NO, PRODUCT_CODE, DOC_STATUS, DO_QUANTITY, DISPATCHED_TON,
            DO_RATE
       FROM DELIVERY_ORDER
      WHERE BRNCH = :b AND CUSTOMER_CODE = :c AND DOC_STATUS IN (${ds.sql})
      ORDER BY DEL_ORDER_NO`,
    { b: brnch, c: code, ...ds.binds },
  );
  const ps = inList('ps', OPEN_PERMIT_STATES);
  const permits = await tx.many(
    `SELECT m.PERMIT_NO, d.LNKNO, d.AREA_DOC, m.PRODUCT_CODE, m.DOC_STATUS, d.QTY, d.DISPATCHED_TON,
            d.CRATE
       FROM PERMIT_MST_CITY m
       JOIN PERMIT_DTL_CITY d ON d.BRNCH = m.BRNCH AND d.PERMIT_NO = m.PERMIT_NO
      WHERE m.BRNCH = :b AND m.CUSTOMER_CODE = :c AND m.DOC_STATUS IN (${ps.sql})
        AND NVL(d.AREA_STATUS, 'OPEN') <> 'CANCELLED'
      ORDER BY m.PERMIT_NO, d.LNKNO`,
    { b: brnch, c: code, ...ps.binds },
  );
  const items = [
    ...dos.map((r) => ({
      kind: 'DO',
      docNo: `${r.DO_TYPE}-${r.DEL_ORDER_NO}`,
      ocNo: r.ORDER_NO === null ? null : Number(r.ORDER_NO),
      productCode: r.PRODUCT_CODE ?? null,
      status: r.DOC_STATUS,
      qtyTon: dec(r.DO_QUANTITY ?? 0).toFixed(3),
      dispatchedTon: dec(r.DISPATCHED_TON ?? 0).toFixed(3),
      rate: dec(r.DO_RATE ?? 0).toFixed(2),
      value: openValue({ qtyTon: r.DO_QUANTITY, dispatchedTon: r.DISPATCHED_TON, rate: r.DO_RATE }),
    })),
    ...permits.map((r) => ({
      kind: 'PERMIT',
      docNo: `${r.PERMIT_NO}/${r.AREA_DOC}`,
      ocNo: null,
      productCode: r.PRODUCT_CODE ?? null,
      status: r.DOC_STATUS,
      qtyTon: dec(r.QTY ?? 0).toFixed(3),
      dispatchedTon: dec(r.DISPATCHED_TON ?? 0).toFixed(3),
      rate: dec(r.CRATE ?? 0).toFixed(2),
      value: openValue({ qtyTon: r.QTY, dispatchedTon: r.DISPATCHED_TON, rate: r.CRATE }),
    })),
  ];
  return items.filter((i) => dec(i.value).gt(0));
}

/** Approved credit per type (BR-BAL-06 fallback to the customer card limit). */
export async function approvedCredit(tx, brnch, code) {
  const cols = Object.values(CREDIT_TYPE_COLUMNS);
  const cur = await tx.one(
    `SELECT ${cols.map((c) => `${c}, ${c}_A`).join(', ')} FROM CREDIT_LIMITS WHERE BRNCH = :b AND CUSTOMER_CODE = :c`,
    { b: brnch, c: code },
  );
  const card = await tx.one(
    'SELECT CREDIT_LIMITE FROM CUSTOMER_INFO WHERE BRNCH = :b AND CUSTOMER_CODE = :c',
    { b: brnch, c: code },
  );
  if (!card) throw Errors.notFound('Customer');
  const types = cur
    ? CREDIT_TYPES.map((t) => {
        const col = CREDIT_TYPE_COLUMNS[t];
        return {
          creditType: t,
          current: dec(cur[col] ?? 0).toFixed(2),
          availed: dec(cur[`${col}_A`] ?? 0).toFixed(2),
          unused: unusedCredit(cur[col], cur[`${col}_A`]),
        };
      }).filter((t) => dec(t.current).gt(0) || dec(t.availed).gt(0))
    : [];
  return {
    hasCreditLimitsRow: !!cur,
    legacyCreditLimit: card.CREDIT_LIMITE === null ? null : dec(card.CREDIT_LIMITE).toFixed(2),
    types,
  };
}

/** Receipts verified today (DC ledger credits of BRVs dated today). By instrument in P2-04. */
async function todayCollection(tx, brnch, code, today) {
  const r = await tx.one(
    `SELECT NVL(SUM(CREDIT), 0) AS AMT, COUNT(*) AS N FROM CUSTOMER_LEDGER
      WHERE BRNCH = :b AND CUSTOMER_CODE = :c AND LEDGER_TYPE = 'DC' AND DOC_TYPE = 'BRV'
        AND ENTRY_KIND = 'RECEIPT' AND ENTRY_DATE = TO_DATE(:d, 'YYYY-MM-DD')`,
    { b: brnch, c: code, d: today },
  );
  return { total: dec(r.AMT).toFixed(2), receipts: Number(r.N) };
}

/**
 * BR-BAL-01/05: available balance with its parts. `value` (optional) adds the shortfall for a
 * document of that value (BR-BAL-03).
 * @param {import('../../lib/oracle/db.js').Tx} tx
 * @param {{ brnch: number, customerCode: string, now: Date, value?: string }} p
 */
export async function available(tx, { brnch, customerCode, now, value }) {
  const [dcLedgerBalance, doLedgerBalance, commitments, credit] = [
    await ledger.balance(tx, { brnch, customerCode, ledgerType: 'DC' }),
    await ledger.balance(tx, { brnch, customerCode, ledgerType: 'DO' }),
    await openCommitments(tx, brnch, customerCode),
    await approvedCredit(tx, brnch, customerCode),
  ];
  const totals = availableBalance({ dcLedgerBalance, commitments, credit });
  return {
    brnch,
    customerCode,
    ...totals,
    doLedgerBalance,
    commitments,
    credit,
    todayCollection: await todayCollection(tx, brnch, customerCode, businessDate(now)),
    ...(value !== undefined ? { value, shortfall: shortfall(value, totals.available) } : {}),
  };
}
