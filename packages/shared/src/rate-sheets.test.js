import { describe, expect, it } from 'vitest';
import { rateChain, zRateLinePatch } from './rate-sheets.js';

const TAX = { fedPerTon: '4000', salesTaxPer: '18' };

describe('rate sheets (BR-PRC-05)', () => {
  it('BR-PRC-05: reproduces the legacy Hattar line (AJK 2146, sheet 1942)', () => {
    const r = rateChain(
      { booking: '32990', freight: '6110', rebate: '0', tax236: '0', mrp: '30272' },
      TAX,
    );
    expect(r).toMatchObject({
      netBook: '26880.00',
      exFactory: '26880.00',
      fed: '4000.00',
      salesTax: '4617.76',
      netRet: '18262.24',
    });
  });

  it('BR-PRC-05: Karachi line without freight (ex-factory = booking)', () => {
    const r = rateChain({ booking: '24500', mrp: '30272' }, TAX);
    expect(r).toMatchObject({ netBook: '24500.00', exFactory: '24500.00', netRet: '15882.24' });
  });

  it('rebate and tax 236 come off before net retention', () => {
    const r = rateChain(
      { booking: '30000', freight: '3000', rebate: '500', tax236: '100', mrp: '30272' },
      TAX,
    );
    expect(r).toMatchObject({ netBook: '27000.00', exFactory: '26500.00', netRet: '17782.24' });
  });

  it('line patch needs at least one value', () => {
    expect(zRateLinePatch.safeParse({}).success).toBe(false);
    expect(zRateLinePatch.safeParse({ booking: '29000' }).success).toBe(true);
  });
});
