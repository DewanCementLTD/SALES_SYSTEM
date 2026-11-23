import { describe, expect, it } from 'vitest';
import { doAdjustment, doRateOf, zDoAdjust } from './do.js';

const doc = { qtyTon: '70.000', dispatchedTon: '0.000', rate: '25200.00', value: '1764000.00' };

describe('DO quantity adjustment (BR-DO-06)', () => {
  it('BR-DO-06: reproduces the legacy advice 2160373 sign and amount for a reduction', () => {
    // legacy reduced DO 22722000041 by 70 t; a reduction to 1 t gives −69 t / −1,738,800
    expect(doAdjustment(doc, '1')).toMatchObject({
      deltaTon: '-69.000',
      deltaValue: '-1738800.00',
      newValue: '25200.00',
      increase: false,
      fullyDispatched: false,
    });
  });
  it('BR-DO-06: an increase debits the difference', () => {
    expect(doAdjustment(doc, '80.5')).toMatchObject({
      toTon: '80.500',
      deltaTon: '10.500',
      deltaValue: '264600.00',
      newValue: '2028600.00',
      increase: true,
    });
  });
  it('BR-DO-04: never below the dispatched quantity; equal to it closes the DO', () => {
    const part = { ...doc, dispatchedTon: '30.000' };
    expect(doAdjustment(part, '29.9').error.ruleId).toBe('BR-DO-04');
    expect(doAdjustment(part, '30').fullyDispatched).toBe(true);
  });
  it('BR-DO-05: reducing to zero is a cancel; unchanged and rate-less DOs are refused', () => {
    expect(doAdjustment(doc, '0').error.ruleId).toBe('BR-DO-05');
    expect(doAdjustment(doc, '70').error.detail).toMatch(/unchanged/);
    expect(doAdjustment({ ...doc, rate: null, value: null }, '50').error.detail).toMatch(/no rate/);
  });
  it('rate falls back to value ÷ quantity', () => {
    expect(doRateOf({ qtyTon: '40', rate: null, value: '1000000' })).toBe('25000.00');
  });
  it('body needs tons and a reason', () => {
    expect(zDoAdjust.safeParse({ qtyTon: '50', reason: 'short' }).success).toBe(false);
    expect(
      zDoAdjust.safeParse({ qtyTon: '50', reason: 'Customer reduced the order' }).success,
    ).toBe(true);
  });
});
