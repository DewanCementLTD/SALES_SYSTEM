import { describe, expect, it } from 'vitest';
import {
  bagsToTons,
  dec,
  formatAmount,
  moneyStr,
  qtyStr,
  roundMoney,
  sum,
  sumRoundedLines,
  tonsToBags,
} from './money.js';

describe('money', () => {
  it('rounds half-up to 2 decimals (BUSINESS_RULES §0)', () => {
    expect(moneyStr('1.005')).toBe('1.01');
    expect(moneyStr('2.675')).toBe('2.68');
    expect(moneyStr('-1.005')).toBe('-1.01');
    expect(roundMoney('0.1').plus('0.2').toFixed(2)).toBe('0.30');
  });

  it('has no float errors', () => {
    expect(sum(['0.1', '0.2']).toString()).toBe('0.3');
    expect(dec(0.1).plus(0.2).equals(dec('0.3'))).toBe(true);
  });

  it('totals = sum of rounded lines (BUSINESS_RULES §0)', () => {
    expect(sumRoundedLines(['1.005', '1.005']).toFixed(2)).toBe('2.02');
  });

  it('rejects non-finite numbers', () => {
    expect(() => dec(Number.NaN)).toThrow();
  });

  it('BR-SRF-01: converts tons and bags at 20 bags per ton', () => {
    expect(tonsToBags('1250').toString()).toBe('25000');
    expect(qtyStr(bagsToTons(25000))).toBe('1250.000');
    expect(qtyStr(bagsToTons(1))).toBe('0.050');
  });

  it('formats PKR with grouping and brackets for advances', () => {
    expect(formatAmount('5545000')).toBe('5,545,000.00');
    expect(formatAmount('-1240500.5', { brackets: true })).toBe('(1,240,500.50)');
    expect(formatAmount('-12')).toBe('-12.00');
    expect(formatAmount('0')).toBe('0.00');
  });
});
