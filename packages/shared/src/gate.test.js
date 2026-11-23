import { describe, expect, it } from 'vitest';
import { combineProblem, overPlanProblem, plannedOf, zGateIn } from './gate.js';

const base = {
  route: 'DO',
  packingType: 'BAG',
  vehicleNo: 'tkn 4521',
  driver: { cnic: '42101-1234567-1', name: 'Ali Khan', mobile: '+92 300 1234567' },
  transpCode: '001',
  biltyNo: 'B-778',
  docs: [{ doType: 'OS', doNo: '22702003944', plannedBags: 700 }],
};

describe('gate-in (BR-GATE)', () => {
  it('BR-GATE-02: vehicle normalised, CNIC 13 digits, mobile 03XXXXXXXXX', () => {
    const b = zGateIn.parse(base);
    expect(b.vehicleNo).toBe('TKN4521');
    expect(b.driver).toMatchObject({ cnic: '4210112345671', mobile: '03001234567' });
    expect(zGateIn.safeParse({ ...base, driver: { ...base.driver, cnic: '123' } }).success).toBe(
      false,
    );
  });
  it('BR-GATE-03: DOs and permits never on one gate pass; bags for BAG, tons for BULK', () => {
    const mixed = {
      ...base,
      docs: [...base.docs, { permitNo: '20272301.2', lnkno: 5, plannedBags: 10 }],
    };
    expect(zGateIn.safeParse(mixed).error.issues[0].message).toMatch(/Mixing/);
    const bulkNoTons = { ...base, packingType: 'BULK' };
    expect(zGateIn.safeParse(bulkNoTons).error.issues[0].message).toMatch(/Tons are required/);
  });
  it('BR-GATE-06: planned weight = bags × 50 kg or tons × 1000', () => {
    expect(plannedOf({ plannedBags: 700 }, 'BAG')).toEqual({
      plannedBags: 700,
      plannedTon: '35.000',
      plannedKg: 35000,
    });
    expect(plannedOf({ plannedTon: '40.5' }, 'BULK')).toEqual({
      plannedBags: null,
      plannedTon: '40.500',
      plannedKg: 40500,
    });
  });
  it('BR-GATE-03: same customer, DO type and destination; permits same product', () => {
    const a = { customerCode: '912-351', doType: 'OS', destGeoCode: 'C1' };
    expect(combineProblem([a, { ...a }], 'DO')).toBeNull();
    expect(combineProblem([a, { ...a, customerCode: 'X' }], 'DO')).toMatch(/same customer/);
    expect(combineProblem([a, { ...a, doType: 'LS' }], 'DO')).toMatch(/DO type/);
    expect(combineProblem([a, { ...a, destGeoCode: 'C2' }], 'DO')).toMatch(/destination/);
    const p = { customerCode: 'C', productCode: 'OPS' };
    expect(combineProblem([p, { ...p, productCode: 'OPC' }], 'PMT')).toMatch(/product/);
  });
  it('BR-DC-02: planned ≤ remaining + tolerance', () => {
    expect(overPlanProblem('25.050', '25.000', 100)).toBeNull();
    expect(overPlanProblem('25.200', '25.000', 100)).toMatch(/more than the 25.000 t left/);
  });
});
