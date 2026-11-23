// Customer ledgers (BUSINESS_RULES §13, TASKS P2-00). Two ledgers per customer and branch:
// DO (orders issued: R1) and DC (goods dispatched: R13). Insert-only; a reversal is a new row
// pointing at the original (REVERSAL_OF). Sign convention (REQUIREMENTS_SPEC R1): running
// amount = previous + debit − credit; positive = receivable, negative = advance.
import { z } from 'zod';
import { dec, formatAmount, qtyStr } from './money.js';
import { zIsoDate } from './validators.js';

export const LEDGER_TYPES = Object.freeze(['DO', 'DC']);

/** Source document of a ledger row (CUSTOMER_LEDGER.DOC_TYPE, VARCHAR2(10)). */
export const LEDGER_DOC_TYPES = Object.freeze([
  'BRV', // bank receipt voucher
  'BOUNCE', // cheque return of a BRV
  'DO',
  'PMT', // permit
  'DOA', // DO / permit quantity adjustment
  'CXL', // DO / permit cancellation (undispatched part)
  'INV', // sales invoice (DC ledger)
  'CN', // credit note
  'DN', // debit note
  'TRF', // balance transfer
  'OPEN', // opening balance (migration)
]);

/** What the row is (CUSTOMER_LEDGER.ENTRY_KIND, VARCHAR2(20)); part of the double-posting UK. */
export const LEDGER_ENTRY_KINDS = Object.freeze([
  'RECEIPT',
  'RETURN', // cheque return
  'ISSUE', // DO / permit value
  'RELEASE', // cancelled undispatched value
  'ADJUST',
  'SALE', // invoice proceeds
  'WHT', // withholding tax line of an invoice
  'MEMO', // DO ledger memo of dispatched qty (no amount)
  'NOTE',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'OPENING',
]);

const zAmount = z
  .string()
  .trim()
  .regex(/^\d{1,14}(\.\d{1,2})?$/, 'Amount must be a non-negative number with up to 2 decimals');

/** One row to post. Amounts are non-negative strings; exactly one side (or none for MEMO). */
export const zLedgerEntry = z
  .object({
    brnch: z.number().int(),
    customerCode: z.string().trim().min(1).max(11),
    ledgerType: z.enum(/** @type {[string, ...string[]]} */ (LEDGER_TYPES)),
    entryDate: zIsoDate,
    docType: z.enum(/** @type {[string, ...string[]]} */ (LEDGER_DOC_TYPES)),
    docYear: z.number().int().nullable().optional(),
    docNo: z.string().trim().min(1).max(30),
    docLine: z.number().int().min(0).default(0),
    entryKind: z.string().regex(/^[A-Z_]{2,20}$/),
    narration: z.string().trim().min(1).max(400),
    debit: zAmount.default('0'),
    credit: zAmount.default('0'),
    qtyTon: z.string().nullable().optional(),
  })
  .superRefine((e, ctx) => {
    const d = dec(e.debit);
    const c = dec(e.credit);
    if (d.gt(0) && c.gt(0))
      ctx.addIssue({ code: 'custom', path: ['credit'], message: 'Debit and credit on one row' });
    if (d.isZero() && c.isZero() && e.entryKind !== 'MEMO')
      ctx.addIssue({ code: 'custom', path: ['debit'], message: 'Amount is zero' });
  });

/** Reversal kind for a row kind: `SALE` → `SALE_REV` (stays unique under the UK). */
export const reversalKind = (kind) => `${kind.slice(0, 16)}_REV`;

/**
 * Row that cancels `orig` (BR-LED: never updated; reversal = new row with REVERSAL_OF).
 * The reversal keeps the source document keys unless another document is given (e.g. BOUNCE).
 * @param {Record<string, any>} orig mapped ledger row
 * @param {{ entryDate: string, narration?: string, docType?: string, docNo?: string, docYear?: number|null, entryKind?: string }} over
 */
export function reversalEntry(orig, over) {
  return {
    brnch: orig.brnch,
    customerCode: orig.customerCode,
    ledgerType: orig.ledgerType,
    entryDate: over.entryDate,
    docType: over.docType ?? orig.docType,
    docYear: over.docYear !== undefined ? over.docYear : orig.docYear,
    docNo: over.docNo ?? orig.docNo,
    docLine: orig.docLine,
    entryKind: over.entryKind ?? reversalKind(orig.entryKind),
    narration: over.narration ?? `Reversal of ${orig.narration}`.slice(0, 400),
    debit: dec(orig.credit).toFixed(2),
    credit: dec(orig.debit).toFixed(2),
    qtyTon: orig.qtyTon ?? null,
    reversalOf: orig.ledgerId,
  };
}

const amt = (v) => formatAmount(v);
const join = (parts) =>
  parts
    .filter((p) => p !== null && p !== undefined && p !== '')
    .join(' · ')
    .slice(0, 400);

/** BR-LED-01 narration builders (one per source). */
export const narration = {
  /** `BRV # 2026100764 · IBFT · MBL · Chq # 123` */
  brv: ({ brvNo, instrument, bank, chequeNo }) =>
    join([`BRV # ${brvNo}`, instrument, bank, chequeNo ? `Chq # ${chequeNo}` : null]),
  bounce: ({ brvNo, chequeNo, reason }) =>
    join([`Cheque return · BRV # ${brvNo}`, chequeNo ? `Chq # ${chequeNo}` : null, reason]),
  /** `DO # 12345 · OC # 678 · 35.000 t @ 24,300.00` */
  do: ({ doNo, ocNo, qtyTon, rate }) =>
    join([`DO # ${doNo}`, ocNo ? `OC # ${ocNo}` : null, `${qtyStr(qtyTon)} t @ ${amt(rate)}`]),
  permit: ({ permitNo, qtyTon, city }) =>
    join([`Permit # ${permitNo}`, city, qtyTon ? `${qtyStr(qtyTon)} t` : null]),
  cancel: ({ what, no, qtyTon }) =>
    join([`Cancelled ${what} # ${no}`, qtyTon ? `${qtyStr(qtyTon)} t undispatched` : null]),
  adjust: ({ what, no, fromTon, toTon }) =>
    join([`Qty adjusted ${what} # ${no}`, `${qtyStr(fromTon)} → ${qtyStr(toTon)} t`]),
  /** `DC # 175002 · INV # 8445 · 35.000 t @ 24,300.00` */
  invoice: ({ dcNo, invoiceNo, qtyTon, rate }) =>
    join([`DC # ${dcNo}`, `INV # ${invoiceNo}`, `${qtyStr(qtyTon)} t @ ${amt(rate)}`]),
  wht: ({ invoiceNo, section, ratePct }) =>
    join([`WHT · INV # ${invoiceNo}`, section, ratePct ? `${ratePct}%` : null]),
  note: ({ kind, noteNo, reason }) =>
    join([`${kind === 'DN' ? 'Debit' : 'Credit'} note # ${noteNo}`, reason]),
  transfer: ({ transferNo, from, to }) =>
    join([`Balance transfer # ${transferNo}`, `${from} → ${to}`]),
  opening: ({ asOf }) => `Opening balance as on ${asOf}`,
};

/**
 * R1 / R13 statement: opening, lines with the running amount, totals, closing.
 * @param {Decimal.Value} opening balance before the first line
 * @param {{ debit: string, credit: string }[]} lines in posting order
 */
export function runningStatement(opening, lines) {
  let run = dec(opening);
  let dr = dec(0);
  let cr = dec(0);
  const out = lines.map((l) => {
    dr = dr.plus(dec(l.debit));
    cr = cr.plus(dec(l.credit));
    run = run.plus(dec(l.debit)).minus(dec(l.credit));
    return { ...l, running: run.toFixed(2) };
  });
  return {
    opening: dec(opening).toFixed(2),
    lines: out,
    totals: { debit: dr.toFixed(2), credit: cr.toFixed(2) },
    closing: run.toFixed(2),
  };
}

/** Receivable (positive) or advance (negative, shown in brackets in R1/R7). */
export const balanceSide = (v) => {
  const d = dec(v);
  if (d.isZero()) return 'NIL';
  return d.isNegative() ? 'ADVANCE' : 'RECEIVABLE';
};
