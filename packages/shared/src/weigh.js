// Weighing rules shared by the weighbridge agent and the API (BUSINESS_RULES §11 BR-WGT).

/** Defaults of the settings WEIGH_STABLE_COUNT / WEIGH_STABLE_KG (BR-WGT-01). */
export const STABLE_DEFAULTS = Object.freeze({ count: 5, kg: 10 });

/**
 * BR-WGT-01: the last `count` readings lie within `kg` of each other (max − min ≤ kg). An
 * indicator that reports "unstable" (motion) on any of them breaks the run.
 * @param {{ kg: number, motion?: boolean }[]} recent newest last
 * @param {{ count?: number, kg?: number }} [rule]
 */
export function isStable(recent, rule = STABLE_DEFAULTS) {
  const count = rule.count ?? STABLE_DEFAULTS.count;
  const band = rule.kg ?? STABLE_DEFAULTS.kg;
  if (!Array.isArray(recent) || recent.length < count) return false;
  const run = recent.slice(-count);
  if (run.some((r) => r.motion || !Number.isFinite(r.kg))) return false;
  const kgs = run.map((r) => r.kg);
  return Math.max(...kgs) - Math.min(...kgs) <= band;
}

/** Keeps the last readings and tells whether the scale is stable (agent side). */
export class StableWindow {
  /** @param {{ count?: number, kg?: number }} [rule] */
  constructor(rule = STABLE_DEFAULTS) {
    this.rule = { ...STABLE_DEFAULTS, ...rule };
    this.items = [];
  }

  /** @param {{ kg: number, motion?: boolean }} r */
  push(r) {
    this.items.push(r);
    if (this.items.length > this.rule.count) this.items.shift();
    return this.stable;
  }

  get stable() {
    return isStable(this.items, this.rule);
  }

  /** Weight to capture: the newest reading of a stable run. */
  get weightKg() {
    return this.items.length ? this.items[this.items.length - 1].kg : null;
  }

  reset() {
    this.items = [];
  }
}
