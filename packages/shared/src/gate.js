// Gate-in rules (BUSINESS_RULES §11.1 BR-GATE, BR-DC-01/02; TASKS P3-04). Pure functions shared by
// the API and the plant PWA (offline gate-in, P3-10).
import { z } from 'zod';
import { BAG_KG_DEFAULT, bagsToTons, dec } from './money.js';
import { zCnic, zMobile, zVehicleNo } from './validators.js';

export const GATE_PASS_OPEN_STATES = Object.freeze([
  'TOKEN',
  'IN',
  'TARE_DONE',
  'GROSS_DONE',
  'VARIANCE_BLOCKED',
  'OVERRIDDEN',
  'INVOICED',
]);
export const PACKING_TYPES = Object.freeze(['BAG', 'BULK']);

const zTons = z
  .string()
  .trim()
  .regex(/^\d{1,4}(\.\d{1,3})?$/, 'Tons: a number with up to 3 decimals')
  .refine((s) => dec(s).gt(0), 'Must be more than 0');

/** One document line of a gate-in: bags for bagged cement, tons for a bulker. */
const zPlanned = z.object({
  plannedBags: z.number().int().min(1).max(4000).optional(),
  plannedTon: zTons.optional(),
});
export const zGateInDoLine = zPlanned.extend({
  doType: z.string().regex(/^[A-Z0-9]{1,10}$/),
  doNo: z.string().regex(/^\d{1,11}$/),
});
export const zGateInPermitLine = zPlanned.extend({
  permitNo: z.string().regex(/^\d{1,12}(\.\d)?$/),
  lnkno: z.number().int(),
});

/** POST /plant/gate-passes (API_SPEC §11). */
export const zGateIn = z
  .object({
    route: z.enum(['DO', 'PMT']),
    packingType: z.enum(PACKING_TYPES),
    vehicleNo: zVehicleNo,
    driver: z.object({
      cnic: zCnic,
      name: z.string().trim().min(2).max(60),
      mobile: zMobile,
    }),
    transpCode: z.string().trim().min(1).max(3),
    biltyNo: z.string().trim().max(30).optional(),
    reportingTime: z.string().max(40).optional(),
    docs: z
      .array(z.union([zGateInDoLine, zGateInPermitLine]))
      .min(1)
      .max(10),
    clientId: z.string().uuid().optional(),
  })
  .superRefine((b, ctx) => {
    b.docs.forEach((d, i) => {
      const isDo = 'doNo' in d;
      if (isDo !== (b.route === 'DO'))
        ctx.addIssue({
          code: 'custom',
          path: ['docs', i],
          message: 'Mixing DOs and permits on one gate pass is not allowed (BR-GATE-03)',
        });
      const want = b.packingType === 'BAG' ? 'plannedBags' : 'plannedTon';
      if (d[want] === undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['docs', i, want],
          message: b.packingType === 'BAG' ? 'Bags are required' : 'Tons are required',
        });
    });
  });

/** BR-GATE-06: planned tons and kg of a line (bags × 50 kg, or tons × 1000 for a bulker). */
export function plannedOf(line, packingType, bagKg = BAG_KG_DEFAULT) {
  const tons =
    packingType === 'BAG' ? dec(bagsToTons(line.plannedBags, bagKg)) : dec(line.plannedTon);
  return {
    plannedBags: packingType === 'BAG' ? line.plannedBags : null,
    plannedTon: tons.toFixed(3),
    plannedKg: tons.times(1000).round().toNumber(),
  };
}

/**
 * BR-GATE-03: documents that can share one vehicle (DOs: same customer, DO type and destination;
 * permits: same customer and product). Returns null or the problem.
 * @param {{ customerCode: string, doType?: string, destGeoCode?: string|null, productCode?: string|null }[]} docs
 * @param {'DO'|'PMT'} route
 */
export function combineProblem(docs, route) {
  const [first, ...rest] = docs;
  for (const d of rest) {
    if (d.customerCode !== first.customerCode) return 'All documents must be of the same customer';
    if (route === 'DO' && d.doType !== first.doType) return 'All DOs must have the same DO type';
    if (route === 'DO' && (d.destGeoCode ?? null) !== (first.destGeoCode ?? null))
      return 'All DOs must go to the same destination';
    if (route === 'PMT' && d.productCode !== first.productCode)
      return 'All permit lines must be of the same product';
  }
  return null;
}

/**
 * BR-DC-02: a line may not plan more than the undispatched balance (+ weight tolerance).
 * @returns {null | string}
 */
export function overPlanProblem(plannedTon, remainingTon, toleranceKg) {
  const limit = dec(remainingTon).plus(dec(toleranceKg ?? 0).dividedBy(1000));
  return dec(plannedTon).gt(limit)
    ? `Planned ${dec(plannedTon).toFixed(3)} t is more than the ${dec(remainingTon).toFixed(3)} t left`
    : null;
}
