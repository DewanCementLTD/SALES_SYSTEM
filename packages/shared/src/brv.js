// Bank Receipt Voucher (BUSINESS_RULES §5, REQUIREMENTS_SPEC 6.3, TASKS P2-04).
// Legacy CASH_CHEQUE_RECEIPTS: key (BRNCH, RECEIPT_NO, CASH_CHEQ_CD = 'Q'); RETURN_CD P = pending,
// C = cleared, R = returned (bounced). The new DOC_STATUS is the source of truth; RETURN_CD is
// kept in sync for the old reports.
import { z } from 'zod';
import { dec } from './money.js';
import { zIsoDate, zReason } from './validators.js';

/** Cash/cheque code of BRVs (the only value in the legacy data). */
export const BRV_CASH_CHEQ_CD = 'Q';

/** BR-BRV-03 verification methods. */
export const VERIFY_METHODS = Object.freeze({
  PHONE: 'Phone call to the bank',
  BANK_PORTAL: 'Bank portal',
  STATEMENT: 'Bank statement',
  OTHER: 'Other',
});

/** Legacy fund-from values seen in CASH_CHEQUE_RECEIPTS.FUND_FROM. */
export const FUND_FROM = Object.freeze(['Business Account', 'Other Account']);

/** Legacy RETURN_CD for a status (kept in sync, SCHEMA §3). */
export const BRV_RETURN_CD = Object.freeze({
  ENTERED: 'P',
  VERIFIED: 'P',
  CLEARED: 'C',
  BOUNCED: 'R',
  CANCELLED: 'P',
});

const zAmt = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Amount: a number with up to 2 decimals');
const zAmtPos = zAmt.refine((s) => dec(s).gt(0), 'Must be more than 0');
const opt = (max) => z.string().trim().max(max).nullable().optional();

/** BRV entry / edit body (API_SPEC §8). */
export const zBrvBody = z.object({
  brvDate: zIsoDate,
  customerCode: z.string().trim().min(1).max(11),
  instCode: z.string().trim().min(1, 'Choose the instrument').max(3),
  category: opt(3), // BR-BRV-01: CATEGORY_TYPE (A Clean, B Transitory, C Cash deposit, D Cheque)
  bankCode: opt(4), // customer's bank (BANK_DESC)
  chequeNo: opt(60),
  chequeDate: zIsoDate.nullable().optional(),
  depositAccount: z.string().trim().min(1, 'Choose the company account').max(6), // COMPANY_BANK
  amount: zAmtPos,
  salesTax: zAmt.nullable().optional(),
  tax: zAmt.nullable().optional(),
  freight: zAmt.nullable().optional(),
  fundFrom: opt(50),
  transporter: opt(20),
  depositor: opt(50),
  city: opt(50),
  remarks: opt(100),
});

export const zBrvVerify = z.object({
  method: z.enum(/** @type {[string, ...string[]]} */ (Object.keys(VERIFY_METHODS))),
  bankRef: z.string().trim().min(2, 'Enter the bank reference').max(100),
  remarks: opt(500),
});

export const zBrvBounce = z.object({ reason: zReason, returnDate: zIsoDate });
export const zBrvClear = z.object({ clearDate: zIsoDate });

/** BR-BRV-03: the maker of a BRV may not verify it. */
export function canVerify({ createdBy }, usrid) {
  if (createdBy && createdBy.toUpperCase() === String(usrid).toUpperCase())
    return { ok: false, reason: 'You entered this BRV; another user must verify it (BR-BRV-03)' };
  return { ok: true };
}
