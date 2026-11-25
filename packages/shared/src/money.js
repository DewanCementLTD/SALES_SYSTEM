// Money and quantity arithmetic. Never use JS floats for business math (CLAUDE.md rule 9).
// Money: PKR, 2 decimals, rounding half-up at line level; totals = sum of rounded lines.
// Quantity: tons, 3 decimals. 1 bag = 50 kg, 20 bags = 1 ton (BUSINESS_RULES §0).
import Decimal from 'decimal.js';

/** Decimal constructor with business rounding (half-up). */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/**
 * @param {Decimal.Value | null | undefined} v
 * @returns {Decimal}
 */
export function dec(v) {
  if (v === null || v === undefined || v === '') return new D(0);
  if (typeof v === 'number' && !Number.isFinite(v))
    throw new RangeError(`Not a finite number: ${v}`);
  return new D(v);
}

/**
 * Forgiving dec() for on-screen previews of what the user is still typing ("24,300", "12.",
 * "abc"): thousands separators are ignored and anything else that is not a number counts as
 * `fallback`. Never use it for business math: the API validates and uses dec().
 * @param {unknown} v
 * @param {Decimal.Value} [fallback]
 */
export function decOr(v, fallback = 0) {
  if (v === null || v === undefined) return new D(fallback);
  const t = typeof v === 'string' ? v.replace(/[,\s]/g, '').replace(/\.$/, '') : v;
  try {
    const d = dec(/** @type {Decimal.Value} */ (t));
    return d.isFinite() ? d : new D(fallback);
  } catch {
    return new D(fallback);
  }
}

/** Round to 2 decimals, half-up. */
export const roundMoney = (v) => dec(v).toDecimalPlaces(2, D.ROUND_HALF_UP);
/** Round to 3 decimals (tons), half-up. */
export const roundQty = (v) => dec(v).toDecimalPlaces(3, D.ROUND_HALF_UP);

/** Money as the JSON wire format: string with exactly 2 decimals. */
export const moneyStr = (v) => roundMoney(v).toFixed(2);
/** Quantity (tons) as string with exactly 3 decimals. */
export const qtyStr = (v) => roundQty(v).toFixed(3);

/** Sum a list of values exactly. */
export function sum(values) {
  return values.reduce((acc, v) => acc.plus(dec(v)), new D(0));
}

/** Sum of line amounts each rounded to 2 decimals first (BUSINESS_RULES §0). */
export function sumRoundedLines(values) {
  return values.reduce((acc, v) => acc.plus(roundMoney(v)), new D(0));
}

export const BAG_KG_DEFAULT = 50;

/** Bags → tons (3 dp). */
export function bagsToTons(bags, bagKg = BAG_KG_DEFAULT) {
  return roundQty(dec(bags).times(bagKg).dividedBy(1000));
}

/** Tons → whole bags (rounded half-up). */
export function tonsToBags(tons, bagKg = BAG_KG_DEFAULT) {
  return dec(tons).times(1000).dividedBy(bagKg).toDecimalPlaces(0, D.ROUND_HALF_UP);
}

const group = (intStr) => intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * PKR display format `1,234,567.00`. Negative values (advances) in brackets when `brackets`.
 * @param {Decimal.Value} v
 * @param {{ brackets?: boolean, decimals?: number }} [opts]
 */
export function formatAmount(v, opts = {}) {
  const { brackets = false, decimals = 2 } = opts;
  const d = dec(v).toDecimalPlaces(decimals, D.ROUND_HALF_UP);
  const neg = d.isNegative() && !d.isZero();
  const [i, f] = d.abs().toFixed(decimals).split('.');
  const body = f ? `${group(i)}.${f}` : group(i);
  if (!neg) return body;
  return brackets ? `(${body})` : `-${body}`;
}
