// Display formatting (PRD §5 localisation): PKR `1,234,567.00`, dates `DD-MM-YYYY`, Asia/Karachi.
import { displayDate, displayDateTime, formatAmount } from '@dcl/shared';

/** Amount for display; text that is not a number (still being typed) shows as "—", never throws. */
function safeAmount(v, opts) {
  if (v === null || v === undefined || v === '') return '—';
  try {
    return formatAmount(v, opts);
  } catch {
    return '—';
  }
}
export const fmtPKR = (v, opts) => safeAmount(v, opts);
export const fmtQty = (v) => safeAmount(v, { decimals: 3 });
export const fmtDate = (v) => (v ? displayDate(v) : '—');
export const fmtDateTime = (v) => (v ? displayDateTime(v) : '—');

/** "Muhammad Ali" → "MA" */
export function initials(name) {
  return String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

/** "2 h ago" style relative time for the bell. */
export function ago(v, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(v).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtDate(v);
}
