import { describe, expect, it } from 'vitest';
import { businessDate, daysBetween, displayDate, fiscalYearOf, fixedClock } from './dates.js';

describe('dates (Asia/Karachi)', () => {
  it('business date uses Karachi time, not UTC', () => {
    // 2026-11-19 20:30 UTC = 2026-11-20 01:30 PKT
    expect(businessDate('2026-11-19T20:30:00Z')).toBe('2026-11-20');
    expect(displayDate('2026-11-19T20:30:00Z')).toBe('20-11-2026');
  });

  it('fiscal year runs July–June and is named by its end year (SALES_YEAR)', () => {
    expect(fiscalYearOf('2026-11-19T05:00:00Z')).toBe(2027);
    expect(fiscalYearOf('2026-06-30T12:00:00Z')).toBe(2026);
    expect(fiscalYearOf('2026-06-30T19:30:00Z')).toBe(2027); // 1 Jul 00:30 PKT
  });

  it('counts calendar days', () => {
    expect(daysBetween('2026-11-01T10:00:00Z', '2026-11-15T01:00:00Z')).toBe(14);
  });

  it('fixed clock returns the same instant', () => {
    const c = fixedClock('2026-11-19T00:00:00Z');
    expect(c.now().toISOString()).toBe('2026-11-19T00:00:00.000Z');
  });
});
