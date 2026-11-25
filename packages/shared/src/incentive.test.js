import { describe, expect, it } from 'vitest';
import { incentiveRun, periodsOverlap, zIncentiveScheme } from './incentive.js';

const scheme = {
  memoDate: '2026-11-01',
  dateFrom: '2026-10-01',
  dateTo: '2026-10-31',
  customerFrom: '100-00',
  customerTo: '999-99',
  products: [
    { productCode: 'OPC', rate: '700' },
    { productCode: 'SRC', rate: '450.50' },
  ],
};

describe('incentive schemes and runs (BR-INC)', () => {
  it('BR-INC-01: amount per customer and product = invoiced tons × rate, rounded per line', () => {
    const run = incentiveRun(
      [
        { customerCode: '912-351', productCode: 'OPC', qtyTon: '2166.11' },
        { customerCode: '912-351', productCode: 'SRC', qtyTon: '10.333' }, // 4655.0165 → 4655.02
        { customerCode: '102-04', productCode: 'OPC', qtyTon: '35' },
        { customerCode: '102-04', productCode: 'PPC', qtyTon: '40' }, // not in the scheme
      ],
      scheme.products,
    );
    expect(run.customers.map((c) => [c.customerCode, c.qtyTon, c.amount])).toEqual([
      ['102-04', '35.000', '24500.00'],
      ['912-351', '2176.443', '1520932.02'],
    ]);
    expect(run.customers[1].lines.map((l) => l.amount)).toEqual(['1516277.00', '4655.02']);
    expect(run).toMatchObject({ qtyTon: '2211.443', amount: '1545432.02' });
  });

  it('BR-INC-01: the scheme needs a period, an ordered customer range and products once each', () => {
    expect(zIncentiveScheme.safeParse(scheme).success).toBe(true);
    expect(zIncentiveScheme.safeParse({ ...scheme, dateTo: '2026-09-30' }).success).toBe(false);
    expect(zIncentiveScheme.safeParse({ ...scheme, customerTo: '099-99' }).success).toBe(false);
    expect(
      zIncentiveScheme.safeParse({
        ...scheme,
        products: [scheme.products[0], scheme.products[0]],
      }).success,
    ).toBe(false);
  });

  it('BR-INC-03: overlapping periods are detected (inclusive ends)', () => {
    const oct = { dateFrom: '2026-10-01', dateTo: '2026-10-31' };
    expect(periodsOverlap(oct, { dateFrom: '2026-10-31', dateTo: '2026-11-30' })).toBe(true);
    expect(periodsOverlap(oct, { dateFrom: '2026-11-01', dateTo: '2026-11-30' })).toBe(false);
  });
});
