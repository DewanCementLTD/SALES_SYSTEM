// City-wise permits (BUSINESS_RULES §8 BR-PMT, REQUIREMENTS_SPEC 7, TASKS P2-05). Raised directly
// (no SRF/OC): customer, product, quantity split by area/city with the city rate from the
// effective rate sheet. Legacy city rate (PERMIT_DTL_CITY.CRATE) = sheet booking − last freight
// rate of the city (freight sheet; the sheet's own freight when the city has none).
import { z } from 'zod';
import { dec, roundMoney } from './money.js';
import { zIsoDate, zReason } from './validators.js';

/** Default city rate for a permit line (net booking with the last freight rate). */
export function permitCityRate(line, lastFreight) {
  if (!line) return null;
  const freight = lastFreight ?? line.freight ?? 0;
  return dec(line.booking ?? 0)
    .minus(dec(freight))
    .toFixed(2);
}

/** Amount of one area line and the permit value (BR-PMT-01). */
export const areaAmount = (qtyTon, rate) => roundMoney(dec(qtyTon).times(dec(rate))).toFixed(2);
export function permitValue(areas) {
  return areas.reduce((s, a) => s.plus(dec(areaAmount(a.qtyTon, a.rate))), dec(0)).toFixed(2);
}

const zTons = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,3})?$/, 'Tons: a number with up to 3 decimals')
  .refine((s) => dec(s).gt(0), 'Must be more than 0');
const zRate = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Rate: a number with up to 2 decimals');

export const zPermitArea = z.object({
  areaDoc: z.string().trim().min(1).max(15),
  qtyTon: zTons,
  rate: zRate.nullable().optional(), // empty = from the rate sheet
});

/** Permit create / edit body (API_SPEC §9). */
export const zPermitBody = z
  .object({
    permitDate: zIsoDate,
    customerCode: z.string().trim().min(1).max(15),
    productCode: z.string().trim().min(1).max(10),
    validTo: zIsoDate.nullable().optional(), // BR-PMT-04: no expiry unless set by hand
    areas: z.array(zPermitArea).min(1, 'Add at least one area').max(100),
  })
  .superRefine((p, ctx) => {
    const docs = p.areas.map((a) => a.areaDoc);
    if (new Set(docs).size !== docs.length)
      ctx.addIssue({ code: 'custom', path: ['areas'], message: 'An area is listed twice' });
    if (p.validTo && p.validTo < p.permitDate)
      ctx.addIssue({
        code: 'custom',
        path: ['validTo'],
        message: 'Valid to is before the permit date',
      });
  });

/** BR-PMT-06 adjust quantities of issued area lines. */
export const zPermitAdjust = z.object({
  lines: z
    .array(z.object({ lnkno: z.number().int(), qtyTon: z.string().regex(/^\d{1,6}(\.\d{1,3})?$/) }))
    .min(1),
  reason: zReason,
});

/** BR-PMT-03: does the quantity force CFO approval (setting PERMIT_CFO_QTY, null = off)? */
export function cfoRequired(qtyTon, threshold) {
  if (threshold === null || threshold === undefined || threshold === '') return false;
  return dec(qtyTon).gt(dec(threshold));
}

/** BR-PMT-08 number display: legacy numbers already hold the suffix (e.g. 20272300.1). */
export const permitNoOf = (seq, brnch) => `${seq}.${brnch}`;
