// Credit / debit notes (BUSINESS_RULES §14 BR-NOTE-01…05, TASKS P4-01). Pure rules shared by the
// API and the note form. Legacy table CREDIT_NOTE (+ CREDIT_NOTE_DETAIL): DB_CR_CD 'C' = credit
// note, 'D' = debit note; credit and debit notes are numbered in their own series (counters CN /
// DN: the legacy rows reuse a number across C and D), so a note is identified by
// (branch, kind, number).
import { z } from 'zod';
import { dec, moneyStr, sum } from './money.js';
import { zIsoDate } from './validators.js';

export const NOTE_KINDS = Object.freeze({ C: 'Credit note', D: 'Debit note' });
/** Numbering counter (DOC_SEQUENCE) and ledger document type per kind. */
export const noteDocType = (kind) => (kind === 'D' ? 'DN' : 'CN');

/** Amount of a line: positive, up to 12 integer digits (CREDIT_NOTE_DETAIL.AMOUNT NUMBER(14,2)). */
const zLineAmount = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Amount must be a number with up to 2 decimals')
  .refine((s) => dec(s).gt(0), 'Amount must be more than 0');

const zPct = z
  .string()
  .trim()
  .regex(/^\d{1,2}(\.\d{1,3})?$|^100(\.0{1,3})?$/, 'WHT % must be between 0 and 100');

export const zNoteLine = z.object({
  particular: z.string().trim().min(3, 'Describe the line').max(60),
  amount: zLineAmount,
  whtPct: zPct.nullable().optional(),
});

const noteBody = {
  noteType: z.string().regex(/^\d{3}$/, 'Note type is a 3-digit code'),
  customerCode: z.string().trim().min(1).max(11),
  date: zIsoDate,
  remarks: z.string().trim().max(500).nullable().optional(),
  // BR-NOTE-01: a sales-return note names the invoice it returns (INVOICE_ID)
  invoiceId: z.number().int().positive().nullable().optional(),
  lines: z.array(zNoteLine).min(1, 'Add at least one line').max(20),
};

/** POST /notes */
export const zNoteCreate = z.object({ kind: z.enum(['C', 'D']), ...noteBody });

/** POST /notes/transfer (BR-NOTE-04): move an amount from customer A to customer B. */
export const zTransferCreate = z
  .object({
    fromCustomer: z.string().trim().min(1, 'Choose the customer to debit').max(11),
    toCustomer: z.string().trim().min(1, 'Choose the customer to credit').max(11),
    amount: zLineAmount,
    date: zIsoDate,
    particular: z.string().trim().min(3, 'Say why the balance moves').max(60),
    remarks: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => v.fromCustomer !== v.toCustomer, {
    path: ['toCustomer'],
    message: 'Choose two different customers',
  });

/**
 * BR-NOTE-02: WHT per line = amount × WHT % (rounded to the paisa, half up); net = Σ lines − WHT.
 * @param {{ amount: string, whtPct?: string|null }[]} lines
 */
export function noteTotals(lines) {
  const out = lines.map((l) => {
    const amount = dec(l.amount);
    const wht = l.whtPct ? amount.times(dec(l.whtPct)).dividedBy(100) : dec(0);
    return { amount: moneyStr(amount), whtPct: l.whtPct ?? null, wht: moneyStr(wht) };
  });
  const gross = sum(out.map((l) => l.amount));
  const wht = sum(out.map((l) => l.wht));
  return {
    lines: out,
    gross: moneyStr(gross),
    wht: moneyStr(wht),
    net: moneyStr(gross.minus(wht)),
  };
}

/**
 * Sales return (BR-NOTE-01, OPEN-Q5): the invoice must be of the same customer, not cancelled,
 * and the returns on it (this one included) cannot exceed what the customer was charged for it
 * (TOTAL_COLLECTABLE: sale proceeds + WHT, the two DC-ledger debits of the invoice).
 * @param {{ customerCode: string, status: string, totalCollectable: string }} inv
 * @param {{ customerCode: string, net: string, earlierReturns: string }} note
 * @returns {null | { ruleId: string, detail: string }}
 */
export function salesReturnProblem(inv, note) {
  if (inv.customerCode !== note.customerCode)
    return { ruleId: 'BR-NOTE-01', detail: 'The invoice belongs to another customer' };
  if (inv.status === 'CANCELLED')
    return { ruleId: 'BR-NOTE-01', detail: 'The invoice is cancelled' };
  const left = dec(inv.totalCollectable).minus(dec(note.earlierReturns));
  if (dec(note.net).gt(left))
    return {
      ruleId: 'BR-NOTE-01',
      detail: `Returns on this invoice cannot exceed ${moneyStr(left)} (invoice ${moneyStr(inv.totalCollectable)}, already returned ${moneyStr(note.earlierReturns)})`,
    };
  return null;
}
