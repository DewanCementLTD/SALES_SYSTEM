import { describe, expect, it } from 'vitest';
import { mrpViolation, nextPriceCode, priceBreakdown } from './pricing.js';

describe('trade prices (BR-PRC)', () => {
  it('spec 15.11: company price = MRP − sales tax − FED', () => {
    const b = priceBreakdown({
      mrp: '12100',
      retailPrice: null,
      salesTaxPer: null,
      salesTaxAmt: '1758.12',
      fedPerTon: '1500',
    });
    expect(b.companyPrice).toBe('8841.88');
  });

  it('legacy OPC period 57: 30,272 − 4,617.76 − 4,000 = 21,654.24 (ST from retail × %)', () => {
    const b = priceBreakdown({
      mrp: '30272',
      retailPrice: '25654.24',
      salesTaxPer: '18',
      salesTaxAmt: null,
      fedPerTon: '4000',
    });
    expect(b).toMatchObject({ salesTaxAmt: '4617.76', companyPrice: '21654.24' });
  });

  it('Hattar period without MRP: MRP = retail + sales tax', () => {
    const b = priceBreakdown({
      mrp: null,
      retailPrice: '25654.24',
      salesTaxPer: '18',
      salesTaxAmt: '4617.76',
      fedPerTon: '4000',
    });
    expect(b).toMatchObject({ mrp: '30272.00', companyPrice: '21654.24' });
  });

  it('BR-PRC-03: above MRP is blocked, equal or below is fine', () => {
    expect(mrpViolation('30272', '30272')).toBeNull();
    expect(mrpViolation('25700', '30272')).toBeNull();
    expect(mrpViolation('30300.50', '30272')).toMatchObject({
      ruleId: 'BR-PRC-03',
      data: { excess: '28.50' },
    });
    expect(mrpViolation('99999', null)).toBeNull();
  });

  it('BR-PRC-01: next version keeps the code and bumps its number', () => {
    expect(nextPriceCode('ABABDOPS18')).toBe('ABABDOPS19');
    expect(nextPriceCode('AEPESOPS09')).toBe('AEPESOPS10');
    expect(nextPriceCode('DSMSRSJL1')).toBe('DSMSRSJL2');
    expect(nextPriceCode(null, 'AAKHT')).toBe('AAKHT01');
    expect(() => nextPriceCode(null)).toThrow();
  });
});
