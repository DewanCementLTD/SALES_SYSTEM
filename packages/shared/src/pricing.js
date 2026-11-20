// Trade prices for DO clients (BR-PRC-01..06, REQUIREMENTS_SPEC 15.11, TASKS P1-06). Pure functions.
import { z } from 'zod';
import { dec } from './money.js';

/**
 * Price breakdown from the product's effective period (BR-TAX-10): company price = MRP − sales tax
 * − FED (spec 15.11: 12,100 − 1,758.12 − 1,500 = 8,841.88). Hattar periods have no MRP (CODE empty):
 * MRP = retail + sales tax, which is what CODE holds in Karachi (25,654.24 + 4,617.76 = 30,272).
 * @param {{ mrp: string|null, retailPrice: string|null, salesTaxPer: string|null, salesTaxAmt: string|null, fedPerTon: string|null }} p
 */
export function priceBreakdown(p) {
  const st =
    p.salesTaxAmt !== null && p.salesTaxAmt !== undefined
      ? dec(p.salesTaxAmt)
      : p.retailPrice && p.salesTaxPer
        ? dec(p.retailPrice).times(p.salesTaxPer).div(100)
        : dec(0);
  const fed = dec(p.fedPerTon ?? 0);
  const mrp =
    p.mrp !== null && p.mrp !== undefined
      ? dec(p.mrp)
      : p.retailPrice !== null && p.retailPrice !== undefined
        ? dec(p.retailPrice).plus(st)
        : null;
  return {
    mrp: mrp === null ? null : mrp.toFixed(2),
    retailPrice: p.retailPrice === null ? null : dec(p.retailPrice).toFixed(2),
    salesTaxPer: p.salesTaxPer === null ? null : dec(p.salesTaxPer).toFixed(2),
    salesTaxAmt: st.toFixed(2),
    fedPerTon: fed.toFixed(2),
    companyPrice: mrp === null ? null : mrp.minus(st).minus(fed).toFixed(2),
  };
}

/**
 * BR-PRC-03: a price may be below the government MRP, never above (hard block).
 * @returns {null | { ruleId: 'BR-PRC-03', detail: string, data: { price: string, mrp: string, excess: string } }}
 */
export function mrpViolation(price, mrp) {
  if (mrp === null || mrp === undefined) return null;
  const d = dec(price).minus(mrp);
  if (d.lte(0)) return null;
  return {
    ruleId: 'BR-PRC-03',
    detail: `Price ${dec(price).toFixed(2)} is above the MRP ${dec(mrp).toFixed(2)} by ${d.toFixed(2)}`,
    data: { price: dec(price).toFixed(2), mrp: dec(mrp).toFixed(2), excess: d.toFixed(2) },
  };
}

/**
 * Next price code for a customer + product + city: the legacy codes end with a version number
 * (ABABDOPS18 → ABABDOPS19). A new key starts at `<base>01`.
 * @param {string|null} latest latest code of the key, if any
 * @param {string} [base] letters for a new key
 */
export function nextPriceCode(latest, base) {
  if (latest) {
    const m = /^(.*?)(\d+)$/.exec(latest);
    if (!m) return `${latest}2`;
    const n = String(Number(m[2]) + 1).padStart(m[2].length, '0');
    return `${m[1]}${n}`;
  }
  if (!base) throw new Error('A price code is needed for a new customer/product/city');
  return `${base}01`;
}

/** New trade price row (BR-PRC-01: a change is a new effective-dated row). */
export const zTradePriceRequest = z.object({
  customerCode: z.string().trim().min(1).max(11),
  productCode: z.string().trim().toUpperCase().min(1).max(4),
  geoCode: z.string().trim().max(50),
  invoicePrice: z
    .string()
    .trim()
    .regex(/^\d{1,9}(\.\d{1,2})?$/, 'Enter the price per ton'),
  efDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  target: z
    .string()
    .trim()
    .regex(/^\d{1,9}(\.\d{1,3})?$/)
    .optional(),
  priceCodeBase: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,7}$/, '2–7 letters')
    .optional(),
});
