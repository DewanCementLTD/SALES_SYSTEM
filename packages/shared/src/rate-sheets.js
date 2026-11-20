// City rate sheets for permit clients (BR-PRC-02/05/06, TASKS P1-07). Pure functions.
import { z } from 'zod';
import { dec } from './money.js';

/**
 * BR-PRC-05 column chain (Islamabad layout; Karachi uses the same columns with freight 0):
 * booking − freight = net booking; − rebate = ex-factory; − tax 236 − FED − sales tax = net retention.
 * Sales tax is the tax inside the MRP: MRP × ST% ÷ (100 + ST%) (legacy: 30,272 × 18/118 = 4,617.76).
 * @param {{ booking: string, freight?: string|null, rebate?: string|null, tax236?: string|null, mrp: string|null }} l
 * @param {{ fedPerTon: string, salesTaxPer: string }} tax from the product's effective period
 */
export function rateChain(l, tax) {
  const booking = dec(l.booking);
  const freight = dec(l.freight ?? 0);
  const rebate = dec(l.rebate ?? 0);
  const tax236 = dec(l.tax236 ?? 0);
  const fed = dec(tax.fedPerTon ?? 0);
  const netBook = booking.minus(freight);
  const exFactory = netBook.minus(rebate);
  const st =
    l.mrp === null || l.mrp === undefined
      ? dec(0)
      : dec(l.mrp).times(tax.salesTaxPer).div(dec(100).plus(tax.salesTaxPer));
  const netRet = exFactory.minus(tax236).minus(fed).minus(st);
  const r2 = (d) => d.toDecimalPlaces(2).toFixed(2);
  return {
    booking: r2(booking),
    freight: r2(freight),
    netBook: r2(netBook),
    rebate: r2(rebate),
    exFactory: r2(exFactory),
    tax236: r2(tax236),
    fed: r2(fed),
    salesTax: r2(st),
    netRet: r2(netRet),
    mrp: l.mrp === null || l.mrp === undefined ? null : r2(dec(l.mrp)),
  };
}

const amount = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, 'Enter an amount');

/** Edit of one line while the sheet is open (only the entered values). */
export const zRateLinePatch = z
  .object({
    booking: amount.optional(),
    freight: amount.optional(),
    rebate: amount.optional(),
    tax236: amount.optional(),
    mrp: amount.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

export const zRateSheetCreate = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
});

export const zSetMrp = z.object({
  productCode: z.string().trim().toUpperCase().min(1).max(10),
  mrp: amount,
});
