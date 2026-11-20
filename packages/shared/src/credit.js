// Credit limits per credit type A–J (BR-CUS-07, REQUIREMENTS_SPEC 15.5, TASKS P1-04).
// Legacy columns: initial limit on CUSTOMER_INFO.<COL>, current limit CREDIT_LIMITS.<COL>,
// availed CREDIT_LIMITS.<COL>_A (decision 20 Nov 2026, BRD log; inferred from the legacy data).
import { z } from 'zod';
import { dec } from './money.js';

export const CREDIT_TYPE_COLUMNS = Object.freeze({
  A: 'CLEAN',
  B: 'TRANSITORY',
  C: 'BILLING',
  D: 'ADVANCE',
  E: 'SECURITY',
  F: 'INCENTIVE',
  G: 'TAX',
  H: 'BOUNCE',
  I: 'BUFFER',
  J: 'BANK_FLOAT',
});
export const CREDIT_TYPES = Object.freeze(Object.keys(CREDIT_TYPE_COLUMNS));

/** Unused credit of one type = current − availed (never below zero). */
export function unusedCredit(current, availed) {
  const u = dec(current ?? 0).minus(dec(availed ?? 0));
  return (u.isNegative() ? dec(0) : u).toFixed(2);
}

/** Credit Limit document request (BR-CUS-07). */
export const zCreditLimitRequest = z.object({
  creditType: z.enum(/** @type {[string, ...string[]]} */ (CREDIT_TYPES)),
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter the new limit (PKR)'),
  remark: z.string().trim().min(3, 'Say why').max(200),
});
