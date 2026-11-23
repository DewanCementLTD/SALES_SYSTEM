import { describe, expect, it } from 'vitest';
import {
  contractValidTo,
  masterPricesFrom,
  ocBreakdown,
  overriddenFields,
  splitSchedule,
  zSrfBody,
} from './index.js';

const body = (o = {}) => ({
  srfDate: '2026-11-23',
  customerCode: '918-353',
  productCode: 'OPC',
  destGeoCode: 'Z3-T23-A104-C542',
  qtyTon: '35',
  bags: 700,
  modeOfDelivery: 'BAGS',
  modeOfTransport: '003',
  schedule: [
    { srNo: 1, date: '2026-11-24', qtyTon: '17.5' },
    { srNo: 2, date: '2026-11-26', qtyTon: '17.5' },
  ],
  ...o,
});
const issues = (b) => {
  const r = zSrfBody.safeParse(b);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('SRF (P2-01)', () => {
  it('a complete local SRF is valid with defaults', () => {
    const r = zSrfBody.parse(body());
    expect(r).toMatchObject({ localExport: 'L', termOfSale: 'A', taxProfile: {} });
  });

  it('BR-SRF-02: schedule total must equal the SRF quantity', () => {
    expect(
      issues(body({ schedule: [{ srNo: 1, date: '2026-11-24', qtyTon: '30' }] })).join(),
    ).toMatch(/Schedule total 30.00 t must equal the SRF quantity 35.00 t/);
  });

  it('BR-SRF-01: bags must match tons (20 bags = 1 ton)', () => {
    expect(issues(body({ bags: 690 })).join()).toMatch(/35 t = 700 bags/);
    expect(issues(body({ bags: null }))).toEqual([]);
    expect(issues(body({ modeOfDelivery: 'BULK', bags: 0 }))).toEqual([]);
  });

  it('BR-SRF-03: export references only required for export', () => {
    expect(issues(body({ localExport: 'E' }))).toHaveLength(3);
    expect(
      issues(body({ localExport: 'E', export: { piNo: 'PI-1', formE: 'FE-1', lcNo: 'LC-1' } })),
    ).toEqual([]);
  });

  it('schedule dates cannot be before the SRF date; numbers unique', () => {
    const msgs = issues(
      body({
        schedule: [
          { srNo: 1, date: '2026-11-01', qtyTon: '17.5' },
          { srNo: 1, date: '2026-11-26', qtyTon: '17.5' },
        ],
      }),
    ).join();
    expect(msgs).toMatch(/before the SRF date/);
    expect(msgs).toMatch(/repeat/);
  });

  it('BR-SRF-02: schedule wizard splits exactly (remainder on the last line)', () => {
    const s = splitSchedule('100', ['2026-11-24', '2026-11-25', '2026-11-26']);
    expect(s.map((l) => l.qtyTon)).toEqual(['33.33', '33.33', '33.34']);
    expect(splitSchedule('35', [])).toEqual([]);
  });

  it('BR-SRF-07: contract valid to = SRF date + months', () => {
    expect(contractValidTo('2026-10-22', 3)).toBe('2027-01-22');
    expect(contractValidTo('2026-11-30', 3)).toBe('2027-02-28');
  });
});

describe('OC pricing (P2-02)', () => {
  // legacy OC 227000755 / trade price SBGKZDROS3
  const tp = {
    priceCode: 'SBGKZDROS3',
    retailPrice: '24284.75',
    salesTaxAmt: '4371.25',
    fedPerTon: '4000',
    invoicePrice: '23200',
  };

  it('BR-OC-01/03: draft prices from the trade price reproduce the legacy OC', () => {
    const master = masterPricesFrom(tp);
    expect(ocBreakdown(master, '157')).toMatchObject({
      consPrice: '23200.00',
      netPrice: '23200.00',
      value: '3642400.00',
      tradeDiscPrice: '24284.75',
    });
    expect(masterPricesFrom(null)).toBeNull();
  });

  it('BR-OC-03: net = consumer − expenses − discount; value rounded half-up', () => {
    const b = ocBreakdown(
      { ...masterPricesFrom(tp), expense: '150.50', discount: '49.50' },
      '10.25',
    );
    expect(b).toMatchObject({ netPrice: '23000.00', value: '235750.00' });
  });

  it('BR-OC-02: deviation from the master value is an override', () => {
    const master = masterPricesFrom(tp);
    expect(overriddenFields(master, master)).toEqual([]);
    expect(overriddenFields(master, { ...master, consPrice: '23100', discount: '5' })).toEqual([
      'consPrice',
      'discount',
    ]);
    expect(overriddenFields(null, { consPrice: '23100' })).toEqual(['consPrice']);
  });
});
