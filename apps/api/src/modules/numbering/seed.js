// BR-NUM-04: seed DOC_SEQUENCE.LAST_NO from the highest legacy number per branch so numbering
// continues. Only inserts missing rows (never lowers or overwrites an existing counter).
// Legacy number formats differ per type (year/month/area embedded); the composition rules are
// still to be confirmed with Finance (TASKS P0-07, SCHEMA §4). Until then the counter continues
// from the raw legacy maximum.
import { DOC_TYPES } from '@dcl/shared';

/**
 * Where each document type's legacy numbers live. `yearCol` limits to one fiscal year when the
 * legacy rows carry it; otherwise the all-time maximum of the branch is used.
 * Table/column names are constants (allow-list), never user input.
 */
export const LEGACY_NUMBER_SOURCES = {
  SRF: { table: 'SALES_REQUEST_MASTER', col: 'SRF_NO', yearCol: 'YEAR' },
  OC: { table: 'ORDER_CONFIRM', col: 'ORDER_NO', yearCol: 'YEAR' },
  BRV: { table: 'CASH_CHEQUE_RECEIPTS', col: 'RECEIPT_NO', yearCol: 'YEAR' },
  DO: { table: 'DELIVERY_ORDER', col: 'DEL_ORDER_NO', yearCol: 'YEAR' },
  PMT: { table: 'PERMIT_MST_CITY', col: 'TRUNC(PERMIT_NO)', yearCol: 'YEAR' },
  DC: { table: 'FH_DELIVERY_CHALLAN', col: 'DC_NO', yearCol: 'YEAR' },
  DM: { table: 'FH_DELIVERY_MEMO', col: 'DM_NO', yearCol: 'YEAR' },
  INV: { table: 'SALES_INVOICE', col: 'INVOICE_NO', yearCol: 'INVOICE_YEAR' },
  CN: { table: 'CREDIT_NOTE', col: 'SRL_NO' },
  DN: { table: 'CREDIT_NOTE', col: 'SRL_NO' }, // one series with CN (SCHEMA §4)
  OCA: { table: 'ORDER_CANCEL_MASTER', col: 'OC_ADVISE_NO', yearCol: 'YEAR' },
  DOA: { table: 'DO_ADJUSTMENT', col: 'ADVICE_NO' },
  INC: { table: 'INCENTIVE', col: 'SRL_NO' },
  CLM: { table: 'CREDIT_LIMITS_F', col: 'SERNO' },
  RSH: { table: 'AREA_RATES_M', col: 'SERNO' },
  // RCX (RECEIPT_CANCEL_MASTER.CANCEL_NO) is text 'YYYY-NNNN'; GP, CXL are new: start from 0.
};

/**
 * Highest legacy number for one branch/type/year (0 when none).
 * @param {import('../../lib/oracle/db.js').Tx} tx
 */
export async function legacyMax(tx, docType, brnch, year) {
  const src = LEGACY_NUMBER_SOURCES[docType];
  if (!src) return '0';
  const binds = { b: brnch };
  let where = 'BRNCH = :b';
  if (src.yearCol) {
    // rows of this fiscal year when the legacy rows carry a year, else all rows of the branch
    const hasYear = await tx.one(
      `SELECT COUNT(*) AS N FROM ${src.table} WHERE BRNCH = :b AND ${src.yearCol} IS NOT NULL`,
      binds,
    );
    if (hasYear.N > 0) {
      where += ` AND ${src.yearCol} = :y`;
      binds.y = year;
    }
  }
  const r = await tx.one(
    `SELECT TO_CHAR(NVL(MAX(${src.col}), 0)) AS MX FROM ${src.table} WHERE ${where}`,
    binds,
  );
  return r.MX;
}

/**
 * Insert missing DOC_SEQUENCE rows for both branches and one fiscal year.
 * @returns {Promise<{ brnch: number, docType: string, lastNo: string, created: boolean }[]>}
 */
export async function seedDocSequence(tx, year) {
  const out = [];
  for (const brnch of [1, 2]) {
    for (const docType of DOC_TYPES) {
      const exists = await tx.one(
        'SELECT TO_CHAR(LAST_NO) AS LAST_NO FROM DOC_SEQUENCE WHERE BRNCH = :b AND YEAR = :y AND DOC_TYPE = :t',
        { b: brnch, y: year, t: docType },
      );
      if (exists) {
        out.push({ brnch, docType, lastNo: exists.LAST_NO, created: false });
        continue;
      }
      const lastNo = await legacyMax(tx, docType, brnch, year);
      await tx.exec(
        `INSERT INTO DOC_SEQUENCE (BRNCH, YEAR, DOC_TYPE, LAST_NO, COMPC) VALUES (:b, :y, :t, TO_NUMBER(:n), 1)`,
        { b: brnch, y: year, t: docType, n: lastNo },
      );
      out.push({ brnch, docType, lastNo, created: true });
    }
  }
  return out;
}
