// Incentive schemes and runs (BUSINESS_RULES §14 BR-INC-01/03, TASKS P4-03). Legacy table
// INCENTIVE is the scheme and its run in one memo: period (DATE_FROM–DATE_TO), customer range
// (CUSTOMER_FROM–CUSTOMER_TO, compared as codes), products with a rate per ton
// (INCENTIVE_PRODUCT), and once committed one row per customer and product (INCENTIVE_DETAIL)
// with a DRAFT credit note (type 008) per customer.
import { z } from 'zod';
import { dec, moneyStr, qtyStr, sum } from './money.js';
import { zIsoDate } from './validators.js';

const zRate = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,2})?$/, 'Rate per ton: up to 6 digits and 2 decimals')
  .refine((s) => dec(s).gt(0), 'Rate must be more than 0');

export const zIncentiveScheme = z
  .object({
    memoNo: z.string().trim().max(30).nullable().optional(),
    memoDate: zIsoDate,
    dateFrom: zIsoDate,
    dateTo: zIsoDate,
    customerFrom: z.string().trim().min(1, 'First customer code').max(11),
    customerTo: z.string().trim().min(1, 'Last customer code').max(11),
    remarks: z.string().trim().max(256).nullable().optional(),
    products: z
      .array(z.object({ productCode: z.string().trim().min(1).max(4), rate: zRate }))
      .min(1, 'Add at least one product')
      .max(20)
      .refine(
        (ps) => new Set(ps.map((p) => p.productCode)).size === ps.length,
        'Each product once',
      ),
  })
  .refine((v) => v.dateFrom <= v.dateTo, {
    path: ['dateTo'],
    message: 'Period ends before it starts',
  })
  .refine((v) => v.customerFrom <= v.customerTo, {
    path: ['customerTo'],
    message: 'Last customer code comes before the first',
  });

/**
 * BR-INC-01: amount per customer and product = invoiced tons in the period × scheme rate, each line
 * rounded to the paisa (half up); customer total = Σ its lines.
 * @param {{ customerCode: string, customerName?: string|null, productCode: string, qtyTon: string }[]} dispatched
 *   invoiced tons per customer and product (already limited to the period, range and products)
 * @param {{ productCode: string, rate: string }[]} products
 */
export function incentiveRun(dispatched, products) {
  const rate = new Map(products.map((p) => [p.productCode, p.rate]));
  /** @type {Map<string, { customerCode: string, customerName: string|null, lines: any[] }>} */
  const by = new Map();
  for (const d of dispatched) {
    const r = rate.get(d.productCode);
    if (!r || dec(d.qtyTon).lte(0)) continue;
    const c = by.get(d.customerCode) ?? {
      customerCode: d.customerCode,
      customerName: d.customerName ?? null,
      lines: [],
    };
    c.lines.push({
      productCode: d.productCode,
      qtyTon: qtyStr(d.qtyTon),
      rate: moneyStr(r),
      amount: moneyStr(dec(d.qtyTon).times(dec(r))),
    });
    by.set(d.customerCode, c);
  }
  const customers = [...by.values()]
    .sort((a, b) => a.customerCode.localeCompare(b.customerCode))
    .map((c) => ({
      ...c,
      qtyTon: qtyStr(sum(c.lines.map((l) => l.qtyTon))),
      amount: moneyStr(sum(c.lines.map((l) => l.amount))),
    }));
  return {
    customers,
    qtyTon: qtyStr(sum(customers.map((c) => c.qtyTon))),
    amount: moneyStr(sum(customers.map((c) => c.amount))),
  };
}

/** Do two periods (inclusive ISO dates) overlap? BR-INC-03 duplicate-run guard. */
export const periodsOverlap = (a, b) => a.dateFrom <= b.dateTo && b.dateFrom <= a.dateTo;
