// Effective-dated tax rates (BR-TAX-05, BR-TAX-10, BR-PRC-01/06, TASKS P1-05). Pure functions:
// the API decides with them, the UI previews with them.
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const pct = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,4})?$/, 'Enter a percentage')
  .refine((v) => Number(v) <= 100, 'At most 100 %');
const money = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter an amount');

/** New WHT rate row (BR-TAX-05). */
export const zTaxRateRequest = z.object({
  // 0 = both branches (not "brnch": the auth plugin treats a body brnch as the target branch)
  scope: z.coerce.number().int().min(0).max(2).default(0),
  filerStatus: z.enum(['F', 'N', 'E']),
  section: z
    .string()
    .trim()
    .toUpperCase()
    .max(20)
    .regex(/^[A-Z0-9()/-]*$/, 'Letters, digits, ( ) / - only')
    .transform((v) => v || '-')
    .default('-'),
  ratePct: pct,
  effectiveFrom: isoDate,
  remarks: z.string().trim().max(200).optional(),
});

/**
 * BR-TAX-05: the WHT rate for (filer status, section, branch, date): among APPROVED rows with
 * EFFECTIVE_FROM ≤ date, the latest start wins; a branch row beats a both-branches (0) row with the
 * same start. Section '-' is the general rate used when no section-specific row exists.
 * @param {{ brnch: number, filerStatus: string, section: string, ratePct: string, effectiveFrom: string, status: string }[]} rows
 * @param {{ brnch: number, filerStatus: string, section?: string, date: string }} q
 */
export function effectiveTaxRate(rows, q) {
  const pick = (section) => {
    const c = rows
      .filter(
        (r) =>
          r.status === 'APPROVED' &&
          r.filerStatus === q.filerStatus &&
          r.section === section &&
          (r.brnch === 0 || r.brnch === q.brnch) &&
          r.effectiveFrom <= q.date,
      )
      .sort((a, b) =>
        a.effectiveFrom === b.effectiveFrom
          ? b.brnch - a.brnch
          : a.effectiveFrom < b.effectiveFrom
            ? 1
            : -1,
      );
    return c[0] ?? null;
  };
  return (q.section && q.section !== '-' ? pick(q.section) : null) ?? pick('-');
}

/** New product period (FED / sales tax / prices) request — inserted into PRODUCT_DESC_T when approved. */
export const zProductPeriodRequest = z.object({
  productCode: z.string().trim().toUpperCase().min(1).max(4),
  dateFrom: isoDate,
  fedPerTon: money,
  salesTaxPer: pct,
  mrp: money.optional(),
  retailPrice: money.optional(),
  companyPrice: money.optional(),
  remarks: z.string().trim().max(200).optional(),
});

/**
 * BR-TAX-10: effective product period for a date = highest PERIOD# with DATE_FROM ≤ date
 * (DATE_TO is ignored; legacy periods overlap).
 * @template {{ period: number, dateFrom: string|null }} T
 * @param {T[]} periods @param {string} date YYYY-MM-DD
 * @returns {T|null}
 */
export function effectiveProductPeriod(periods, date) {
  let best = null;
  for (const p of periods) {
    if (!p.dateFrom || p.dateFrom > date) continue;
    if (!best || p.period > best.period) best = p;
  }
  return best;
}
