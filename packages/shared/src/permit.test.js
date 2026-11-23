import { describe, expect, it } from 'vitest';
import { cfoRequired, permitCityRate, permitNoOf, permitValue, zPermitBody } from './index.js';

describe('permits (P2-05)', () => {
  it('BR-PMT-01: city rate = sheet booking − last freight rate (legacy 20272298.1 / 2216)', () => {
    expect(permitCityRate({ booking: '28200.00', freight: '1600.00' }, '1800.00')).toBe('26400.00');
    expect(permitCityRate({ booking: '28090.00', freight: '3020.00' }, null)).toBe('25070.00');
    expect(permitCityRate(null, '1')).toBeNull();
  });

  it('BR-PMT-01: value = Σ qty × rate per area', () => {
    expect(
      permitValue([
        { qtyTon: '180', rate: '25070' },
        { qtyTon: '35.5', rate: '25620.25' },
      ]),
    ).toBe('5422118.88');
  });

  it('body: areas unique; no expiry required (BR-PMT-04)', () => {
    const ok = {
      permitDate: '2026-11-23',
      customerCode: '1502-22-080',
      productCode: 'OPS',
      areas: [{ areaDoc: '2190', qtyTon: '40' }],
    };
    expect(zPermitBody.safeParse(ok).success).toBe(true);
    expect(zPermitBody.safeParse({ ...ok, areas: [...ok.areas, ...ok.areas] }).success).toBe(false);
    expect(zPermitBody.safeParse({ ...ok, validTo: '2026-11-01' }).success).toBe(false);
  });

  it('BR-PMT-03: CFO threshold only when the setting is set', () => {
    expect(cfoRequired('500', null)).toBe(false);
    expect(cfoRequired('500', '400')).toBe(true);
    expect(cfoRequired('400', '400')).toBe(false);
  });

  it('BR-PMT-08: permit number = sequence + branch suffix', () => {
    expect(permitNoOf('20272301', 2)).toBe('20272301.2');
  });
});
