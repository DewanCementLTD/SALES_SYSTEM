import { describe, expect, it } from 'vitest';
import { StableWindow, isStable } from './weigh.js';

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
