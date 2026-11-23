// Delivery order quantity adjustment (BUSINESS_RULES §9 BR-DO-06, §13 "DO/permit quantity
// adjusted": Dr/Cr difference in the DO ledger). The change is an advice (DO_ADJUSTMENT) that is
// applied once approved; the DO row is never edited without it. Legacy example (Karachi, advice
// 2160373): DO 22722000041, 70 t at 25,200 → QUANTITY −70, AMOUNT −1,764,000.
import { z } from 'zod';
import { dec, roundMoney } from './money.js';
import { zReason } from './validators.js';

/** Advice states (PENDING_APPROVAL → APPROVED | REJECTED; APPROVED straight away when no rule). */
export const DO_ADJUST_STATUS = Object.freeze(['PENDING_APPROVAL', 'APPROVED', 'REJECTED']);

/** Rate per ton of a DO: DO_RATE, else value ÷ quantity (as for the cancel release). */
export function doRateOf(d) {
  if (d.rate !== null && d.rate !== undefined) return dec(d.rate).toFixed(2);
  if (d.value && dec(d.qtyTon ?? 0).gt(0)) return dec(d.value).dividedBy(dec(d.qtyTon)).toFixed(2);
  return null;
}

/**
 * BR-DO-06: what an adjustment to `newQtyTon` changes. Errors (as { ruleId, detail }) when the new
 * quantity is below what was dispatched (BR-DO-04), equal to the current quantity, or the DO has
 * no rate. A reduction to 0 is a cancel (BR-DO-05), not an adjustment.
 * @param {{ qtyTon: string, dispatchedTon: string, rate?: string|null, value?: string|null }} d
 * @param {string} newQtyTon
 */
export function doAdjustment(d, newQtyTon) {
  const qty = dec(d.qtyTon);
  const next = dec(newQtyTon);
  const disp = dec(d.dispatchedTon ?? 0);
  if (next.lte(0))
    return { error: { ruleId: 'BR-DO-05', detail: 'To take the whole DO back, cancel it' } };
  if (next.lt(disp))
    return {
      error: {
        ruleId: 'BR-DO-04',
        detail: `${disp.toFixed(3)} t is already dispatched; the DO cannot be less than that`,
      },
    };
  if (next.eq(qty)) return { error: { ruleId: 'BR-DO-06', detail: 'The quantity is unchanged' } };
  const rate = doRateOf(d);
  if (rate === null)
    return { error: { ruleId: 'BR-DO-06', detail: 'The DO has no rate or value to adjust' } };
  const deltaQty = next.minus(qty);
  const deltaValue = roundMoney(deltaQty.times(dec(rate)));
  const oldValue = d.value ? dec(d.value) : roundMoney(qty.times(dec(rate)));
  return {
    fromTon: qty.toFixed(3),
    toTon: next.toFixed(3),
    deltaTon: deltaQty.toFixed(3),
    rate,
    deltaValue: deltaValue.toFixed(2),
    newValue: oldValue.plus(deltaValue).toFixed(2),
    increase: deltaQty.gt(0),
    // BR-DO-04: nothing left to lift → DISPATCHED
    fullyDispatched: next.lte(disp),
  };
}

const zTons = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,3})?$/, 'Tons: a number with up to 3 decimals');

/** POST /do/{brnch}/{doType}/{doNo}/adjust */
export const zDoAdjust = z.object({ qtyTon: zTons, reason: zReason });
