import { describe, expect, it } from 'vitest';
import { StableWindow, allocateKg, isStable, tareWarning, varianceOf } from './weigh.js';

const r = (...kgs) => kgs.map((kg) => ({ kg }));

describe('stable reading (BR-WGT-01)', () => {
  it('BR-WGT-01: 5 consecutive readings within 10 kg are stable', () => {
    expect(isStable(r(41250, 41255, 41248, 41252, 41250))).toBe(true);
    expect(isStable(r(41250, 41255, 41261, 41252, 41250))).toBe(false); // band 13 kg
    expect(isStable(r(41250, 41255, 41250, 41252))).toBe(false); // only 4
  });
  it('BR-WGT-01: a motion flag from the indicator breaks the run; settings change the rule', () => {
    const run = r(100, 100, 100, 100, 100);
    run[2].motion = true;
    expect(isStable(run)).toBe(false);
    expect(isStable(r(100, 120, 110), { count: 3, kg: 20 })).toBe(true);
  });
  it('the window follows the truck: ramp, then settle', () => {
    const w = new StableWindow();
    for (const kg of [0, 9000, 25000, 41100, 41240]) w.push({ kg });
    expect(w.stable).toBe(false);
    for (const kg of [41250, 41252, 41249, 41250, 41251]) w.push({ kg });
    expect(w.stable).toBe(true);
    expect(w.weightKg).toBe(41251);
    w.reset();
    expect(w.stable).toBe(false);
  });
});

describe('net, variance, allocation (BR-WGT-03…06)', () => {
  it('BR-WGT-05: within ±100 kg is OK; outside is blocked; direction shown', () => {
    expect(varianceOf(35080, 35000, 100)).toEqual({
      varianceKg: 80,
      variancePct: '0.229',
      direction: 'OVER',
      withinTolerance: true,
    });
    expect(varianceOf(34850, 35000, 100)).toMatchObject({
      varianceKg: -150,
      direction: 'UNDER',
      withinTolerance: false,
    });
  });
  it('BR-WGT-06: pro rata by planned kg, largest remainder, exact total', () => {
    expect(allocateKg(35080, [20000, 15000])).toEqual([20046, 15034]);
    const parts = allocateKg(10001, [1, 1, 1]);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(10001);
    expect(parts).toEqual([3334, 3334, 3333]);
  });
  it('BR-WGT-03: a tare far from the last one warns', () => {
    expect(tareWarning(15020, 15100, 300)).toBeNull();
    expect(tareWarning(15020, 14500, 300)).toMatch(/\+520 kg/);
    expect(tareWarning(15020, null, 300)).toBeNull();
  });
});
