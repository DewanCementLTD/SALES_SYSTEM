// Dates: business time zone Asia/Karachi. Business logic never calls `new Date()` directly:
// it receives a clock (CLAUDE.md code style) so tests can fix "now".
import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';

export const TIME_ZONE = 'Asia/Karachi';

/**
 * @typedef {{ now: () => Date }} Clock
 */

/** Real clock. */
export const systemClock = { now: () => new Date() };

/** Fixed clock for tests. @param {Date|string} at */
export function fixedClock(at) {
  const d = new Date(at);
  return { now: () => new Date(d.getTime()) };
}

/** Date in Karachi time. @param {Date|string|number} d */
export const inKarachi = (d) => new TZDate(new Date(d).getTime(), TIME_ZONE);

/** Business date (date part in Karachi) as `YYYY-MM-DD`. */
export const businessDate = (d) => format(inKarachi(d), 'yyyy-MM-dd');

/** Display date `DD-MM-YYYY` (PRD §5). */
export const displayDate = (d) => format(inKarachi(d), 'dd-MM-yyyy');

/** Display date-time `DD-MM-YYYY HH:mm`. */
export const displayDateTime = (d) => format(inKarachi(d), 'dd-MM-yyyy HH:mm');

/**
 * Fiscal year (SALES_YEAR.YEAR) for a date: July–June, named by the year it ends.
 * 2026-11-19 → 2027 (1 Jul 2026 – 30 Jun 2027).
 */
export function fiscalYearOf(d) {
  const k = inKarachi(d);
  return k.getMonth() >= 6 ? k.getFullYear() + 1 : k.getFullYear();
}

/** Whole days from a to b (b − a) in Karachi calendar days. */
export function daysBetween(a, b) {
  const da = Date.UTC(...ymd(a));
  const db = Date.UTC(...ymd(b));
  return Math.round((db - da) / 86_400_000);
}

function ymd(d) {
  const k = inKarachi(d);
  return [k.getFullYear(), k.getMonth(), k.getDate()];
}
