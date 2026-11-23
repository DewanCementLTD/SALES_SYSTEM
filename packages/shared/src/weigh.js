// Weighing rules shared by the weighbridge agent and the API (BUSINESS_RULES §11 BR-WGT).
import { dec } from './money.js';

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

/**
 * BR-WGT-04/05: variance of the net weight against the planned weight.
 * @returns {{ varianceKg: number, variancePct: string, direction: 'OVER'|'UNDER'|'EXACT',
 *   withinTolerance: boolean }}
 */
export function varianceOf(netKg, plannedKg, toleranceKg) {
  const v = Math.round(netKg) - Math.round(plannedKg);
  const pct = plannedKg ? ((v / plannedKg) * 100).toFixed(3) : '0.000';
  return {
    varianceKg: v,
    variancePct: pct,
    direction: v > 0 ? 'OVER' : v < 0 ? 'UNDER' : 'EXACT',
    withinTolerance: Math.abs(v) <= Number(toleranceKg ?? 0),
  };
}

/**
 * BR-WGT-06: net kg split over the lines pro rata by planned kg, largest remainder, so the parts
 * add up to the net exactly. Ties go to the earlier line.
 * @param {number} netKg
 * @param {number[]} plannedKg per line
 * @returns {number[]}
 */
export function allocateKg(netKg, plannedKg) {
  const total = plannedKg.reduce((s, p) => s + p, 0);
  if (!plannedKg.length) return [];
  if (total <= 0) return plannedKg.map((_, i) => (i === 0 ? netKg : 0));
  const exact = plannedKg.map((p) => dec(netKg).times(p).dividedBy(total));
  const parts = exact.map((x) => x.floor().toNumber());
  let left = netKg - parts.reduce((s, p) => s + p, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x.minus(x.floor()) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts;
}

/** BR-WGT-03: warning (not a block) when the tare differs from the vehicle's last tare. */
export function tareWarning(tareKg, lastTareKg, warnKg) {
  if (lastTareKg === null || lastTareKg === undefined) return null;
  const diff = Math.round(tareKg - lastTareKg);
  return Math.abs(diff) > Number(warnKg ?? 0)
    ? `Tare ${tareKg} kg differs from this vehicle's last tare ${lastTareKg} kg by ${diff > 0 ? '+' : ''}${diff} kg`
    : null;
}
