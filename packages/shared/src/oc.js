// Order Confirmation pricing (BUSINESS_RULES §4, REQUIREMENTS_SPEC 6.1, TASKS P2-02/P2-03).
// Legacy OCs copy the trade price: consumer price = TRADE_PRICE.INVOICE_PRICE, retail price /
// sales tax / FED from the same row; net price = consumer price − expenses − discount;
// OC value = net price × tons (BR-OC-03).
import { z } from 'zod';
import { dec, roundMoney } from './money.js';

/** Editable price fields of an OC, in breakdown order (BR-OC-03). */
export const OC_PRICE_FIELDS = Object.freeze([
  'retailPrice',
  'tradeDisc',
  'salesTax',
  'fed',
  'consPrice',
  'expense',
  'discount',
]);

export const OC_PRICE_LABELS = Object.freeze({
  retailPrice: 'Retail price',
  tradeDisc: 'Trade discount',
  tradeDiscPrice: 'Trade-discount price',
  salesTax: 'Sales tax',
  fed: 'FED',
  consPrice: 'Consumer price',
  expense: 'Less expenses',
  discount: 'Less discount',
  netPrice: 'Net price',
});

const m2 = (v) => roundMoney(v ?? 0).toFixed(2);

/**
 * BR-OC-01: master prices of a draft OC from the effective trade price (null = no trade price;
 * the OC is built with zero prices and every entered price is an override).
 * @param {{ priceCode: string, retailPrice: any, salesTaxAmt: any, fedPerTon: any, invoicePrice: any } | null} tp
 */
export function masterPricesFrom(tp) {
  if (!tp) return null;
  return {
    priceCode: tp.priceCode,
    retailPrice: m2(tp.retailPrice),
    tradeDisc: '0.00',
    salesTax: m2(tp.salesTaxAmt),
    fed: m2(tp.fedPerTon),
    consPrice: m2(tp.invoicePrice),
    expense: '0.00',
    discount: '0.00',
  };
}

/** BR-OC-03 breakdown + value for prices and a quantity. */
export function ocBreakdown(prices, qtyTon) {
  const p = Object.fromEntries(OC_PRICE_FIELDS.map((k) => [k, dec(prices?.[k] ?? 0)]));
  const netPrice = p.consPrice.minus(p.expense).minus(p.discount);
  return {
    ...Object.fromEntries(OC_PRICE_FIELDS.map((k) => [k, p[k].toFixed(2)])),
    tradeDiscPrice: p.retailPrice.minus(p.tradeDisc).toFixed(2),
    netPrice: netPrice.toFixed(2),
    value: roundMoney(netPrice.times(dec(qtyTon ?? 0))).toFixed(2),
  };
}

/** BR-OC-02: price fields that differ from the master values (empty = no override). */
export function overriddenFields(master, prices) {
  if (!master) return OC_PRICE_FIELDS.filter((k) => dec(prices?.[k] ?? 0).gt(0));
  return OC_PRICE_FIELDS.filter((k) => !dec(prices?.[k] ?? 0).eq(dec(master[k] ?? 0)));
}

const zPrice = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Price: a number with up to 2 decimals');

export const zOcPrices = z.object(Object.fromEntries(OC_PRICE_FIELDS.map((k) => [k, zPrice])));

const zTons2 = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,2})?$/, 'Tons: a number with up to 2 decimals')
  .refine((s) => dec(s).gt(0), 'Must be more than 0');

/** BR-OC-02: what can be edited on a DRAFT / REVIEWED OC. */
export const zOcUpdate = z
  .object({
    qtyTon: zTons2,
    prices: zOcPrices,
    remarks: z.string().trim().max(100).nullable().optional(),
    schedule: z
      .array(
        z.object({
          srNo: z.number().int().min(1).max(999),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
          qtyTon: zTons2,
        }),
      )
      .min(1, 'Add at least one schedule line')
      .max(60),
  })
  .superRefine((o, ctx) => {
    const total = o.schedule.reduce((a, l) => a.plus(dec(l.qtyTon)), dec(0));
    if (!total.eq(dec(o.qtyTon)))
      ctx.addIssue({
        code: 'custom',
        path: ['schedule'],
        message: `Schedule total ${total.toFixed(2)} t must equal the OC quantity ${dec(o.qtyTon).toFixed(2)} t`,
      });
    const nos = o.schedule.map((l) => l.srNo);
    if (new Set(nos).size !== nos.length)
      ctx.addIssue({ code: 'custom', path: ['schedule'], message: 'Schedule line numbers repeat' });
  });

/** BR-OC-05: BRVs funding the OC (verified only; amount ≤ what is left on the BRV). */
export const zOcBrvLinks = z.object({
  links: z
    .array(
      z.object({
        receiptNo: z.string().regex(/^\d{1,16}$/),
        amount: z
          .string()
          .trim()
          .regex(/^\d{1,12}(\.\d{1,2})?$/)
          .refine((s) => dec(s).gt(0), 'Must be more than 0'),
      }),
    )
    .max(50),
});

export const zOcOverrideRequest = z.object({
  kind: z.enum(['BALANCE', 'PRICE']),
  reason: z.string().trim().min(10, 'Reason must be at least 10 characters').max(1000),
});

export const zOcConfirm = z.object({
  doType: z.string().trim().min(1, 'Choose the DO type').max(10),
});

/** Price-override flag on ORDER_CONFIRM.PRICE_OVERRIDE: N none, Y pending approval, A approved. */
export const PRICE_OVERRIDE = Object.freeze({ NONE: 'N', PENDING: 'Y', APPROVED: 'A' });
