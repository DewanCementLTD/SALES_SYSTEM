import { describe, expect, it } from 'vitest';
import {
  effectiveProductPeriod,
  effectiveTaxRate,
  zProductPeriodRequest,
  zTaxRateRequest,
} from './tax-rates.js';

const row = (o) => ({ brnch: 0, filerStatus: 'F', section: '-', status: 'APPROVED', ...o });

describe('tax rates (P1-05)', () => {
  it('BR-TAX-05: latest approved start on or before the date wins', () => {
    const rows = [
      row({ ratePct: '0.1', effectiveFrom: '2025-07-01' }),
      row({ ratePct: '0.2', effectiveFrom: '2026-07-01' }),
      row({ ratePct: '0.5', effectiveFrom: '2027-01-01' }),
      row({ ratePct: '9', effectiveFrom: '2026-08-01', status: 'PENDING_APPROVAL' }),
    ];
    expect(effectiveTaxRate(rows, { brnch: 1, filerStatus: 'F', date: '2026-11-20' }).ratePct).toBe(
      '0.2',
    );
    expect(effectiveTaxRate(rows, { brnch: 1, filerStatus: 'F', date: '2025-06-30' })).toBeNull();
    expect(effectiveTaxRate(rows, { brnch: 1, filerStatus: 'N', date: '2026-11-20' })).toBeNull();
  });

  it('BR-TAX-05: branch row beats both-branches row; section row beats general row', () => {
    const rows = [
      row({ ratePct: '0.1', effectiveFrom: '2026-07-01' }),
      row({ ratePct: '0.15', effectiveFrom: '2026-07-01', brnch: 2 }),
      row({ ratePct: '1', effectiveFrom: '2026-07-01', section: '236H' }),
    ];
    expect(effectiveTaxRate(rows, { brnch: 2, filerStatus: 'F', date: '2026-11-20' }).ratePct).toBe(
      '0.15',
    );
    expect(effectiveTaxRate(rows, { brnch: 1, filerStatus: 'F', date: '2026-11-20' }).ratePct).toBe(
      '0.1',
    );
    expect(
      effectiveTaxRate(rows, { brnch: 1, filerStatus: 'F', section: '236H', date: '2026-11-20' })
        .ratePct,
    ).toBe('1');
    expect(
      effectiveTaxRate(rows, { brnch: 1, filerStatus: 'F', section: '236G', date: '2026-11-20' })
        .ratePct,
    ).toBe('0.1');
  });

  it('BR-TAX-10: highest period with Date from on or before the date, Date to ignored', () => {
    const periods = [
      { period: 56, dateFrom: '2025-07-01' },
      { period: 57, dateFrom: '2026-09-30' },
      { period: 55, dateFrom: '2026-10-01' }, // later start but lower number (legacy overlap)
      { period: 58, dateFrom: '2027-01-01' },
    ];
    expect(effectiveProductPeriod(periods, '2026-11-20').period).toBe(57);
    expect(effectiveProductPeriod(periods, '2026-09-29').period).toBe(56);
    expect(effectiveProductPeriod(periods, '2020-01-01')).toBeNull();
  });

  it('request schemas validate rates and dates', () => {
    expect(
      zTaxRateRequest.parse({ filerStatus: 'F', ratePct: '0.1', effectiveFrom: '2026-07-01' }),
    ).toMatchObject({ scope: 0, section: '-' });
    expect(
      zTaxRateRequest.safeParse({ filerStatus: 'F', ratePct: '101', effectiveFrom: '2026-07-01' })
        .success,
    ).toBe(false);
    expect(
      zProductPeriodRequest.safeParse({
        productCode: 'opc',
        dateFrom: '2027-01-01',
        fedPerTon: '4000',
        salesTaxPer: '18',
      }).success,
    ).toBe(true);
  });
});
