// Sales Request Form (BUSINESS_RULES §3, REQUIREMENTS_SPEC §5, TASKS P2-01).
// Quantities on SRF/OC rows are NUMBER(8,2) tons (legacy columns): 2 decimals.
import { addMonths, format } from 'date-fns';
import { z } from 'zod';
import { dec, tonsToBags } from './money.js';
import { zIsoDate } from './validators.js';

export const DELIVERY_MODES = Object.freeze({ BAGS: 'Bags', BULK: 'Bulker' });
export const LOCAL_EXPORT = Object.freeze({ L: 'Local', E: 'Export' });
/** Term of sale (legacy TERM_OF_SALE). Only "A = Advance" is seen in the legacy data. */
export const TERMS_OF_SALE = Object.freeze({ A: 'Advance' });

const zTons = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,2})?$/, 'Tons: a number with up to 2 decimals')
  .refine((s) => dec(s).gt(0), 'Must be more than 0');

export const zScheduleLine = z.object({
  srNo: z.number().int().min(1).max(999),
  date: zIsoDate,
  qtyTon: zTons,
});

const opt = (max) => z.string().trim().max(max).nullable().optional();

export const zTaxProfile = z.object({
  stType: opt(1),
  strn: opt(25),
  ntn: opt(50),
  cnic: opt(50),
});

export const zExportRefs = z.object({
  piNo: opt(40),
  formE: opt(30),
  lcNo: opt(20),
});

const srfShape = {
  srfDate: zIsoDate,
  customerCode: z.string().trim().min(1).max(11),
  productCode: z.string().trim().min(1).max(4),
  destGeoCode: z.string().trim().min(1, 'Choose the destination city').max(50),
  bagCode: z.number().int().nullable().optional(),
  bagColour: z.number().int().nullable().optional(),
  qtyTon: zTons,
  bags: z.number().int().min(0).nullable().optional(),
  modeOfDelivery: z.enum(['BAGS', 'BULK']),
  modeOfTransport: z.string().trim().min(1).max(3),
  localExport: z.enum(['L', 'E']).default('L'),
  termOfSale: z
    .string()
    .regex(/^[A-Z]$/)
    .default('A'),
  specialInstructions: opt(100),
  remarks: opt(100),
  doHandoverTo: opt(60),
  taxProfile: zTaxProfile.default({}),
  export: zExportRefs.nullable().optional(),
  legalRequirements: opt(1000),
  crRemarks: opt(1000),
  schedule: z.array(zScheduleLine).min(1, 'Add at least one schedule line').max(60),
};

/** Problems of an SRF body (BR-SRF-01/02/03); [] when valid. */
export function srfProblems(s) {
  const out = [];
  const total = s.schedule.reduce((a, l) => a.plus(dec(l.qtyTon)), dec(0));
  if (!total.eq(dec(s.qtyTon))) {
    out.push({
      path: ['schedule'],
      message: `Schedule total ${total.toFixed(2)} t must equal the SRF quantity ${dec(s.qtyTon).toFixed(2)} t (BR-SRF-02)`,
    });
  }
  const nos = s.schedule.map((l) => l.srNo);
  if (new Set(nos).size !== nos.length)
    out.push({ path: ['schedule'], message: 'Schedule line numbers repeat' });
  s.schedule.forEach((l, i) => {
    if (l.date < s.srfDate)
      out.push({ path: ['schedule', i, 'date'], message: 'Schedule date is before the SRF date' });
  });
  if (s.localExport === 'E') {
    const e = s.export ?? {};
    for (const [k, label] of [
      ['piNo', 'P.I. No.'],
      ['formE', 'Form-E'],
      ['lcNo', 'L.C. No.'],
    ]) {
      if (!e[k])
        out.push({ path: ['export', k], message: `${label} is required for export (BR-SRF-03)` });
    }
  }
  if (s.modeOfDelivery === 'BAGS' && s.bags !== null && s.bags !== undefined) {
    const expect = tonsToBags(s.qtyTon).toNumber();
    if (s.bags !== expect)
      out.push({ path: ['bags'], message: `${s.qtyTon} t = ${expect} bags (BR-SRF-01)` });
  }
  return out;
}

const refine = (s, ctx) => {
  for (const p of srfProblems(s)) ctx.addIssue({ code: 'custom', ...p });
};

/** SRF create / update body (API_SPEC §6). */
export const zSrfBody = z.object(srfShape).superRefine(refine);

/**
 * Schedule wizard: split a quantity over dates; equal parts at 2 decimals, the remainder on the
 * last line so the total is exact (BR-SRF-02).
 * @param {string} qtyTon
 * @param {string[]} dates YYYY-MM-DD
 */
export function splitSchedule(qtyTon, dates) {
  if (!dates.length) return [];
  const total = dec(qtyTon);
  const part = total.dividedBy(dates.length).toDecimalPlaces(2, 1); // round down
  return dates.map((date, i) => ({
    srNo: i + 1,
    date,
    qtyTon: (i === dates.length - 1 ? total.minus(part.times(dates.length - 1)) : part).toFixed(2),
  }));
}

/** BR-SRF-07: contract validity = SRF date + months (setting CONTRACT_VALID_MONTHS). */
export function contractValidTo(srfDate, months) {
  return format(addMonths(new Date(`${srfDate}T00:00:00`), months), 'yyyy-MM-dd');
}

/** BR-SRF-06: an SRF can be cancelled while its OC is not confirmed. */
export const SRF_CANCELLABLE_OC_STATES = Object.freeze(['DRAFT', 'REVIEWED', 'APPROVED']);
