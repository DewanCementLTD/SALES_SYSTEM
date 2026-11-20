import { describe, expect, it } from 'vitest';
import {
  zCnic,
  zMobile,
  zMoney,
  zMoneyPos,
  zNtn,
  zQty,
  zReason,
  zStrn,
  zVehicleNo,
  zWhatsapp,
} from './validators.js';

const ok = (s, v) => s.safeParse(v).success;

describe('validators (BR-DQ-02, BR-CUS-05, BR-GATE-02)', () => {
  it('money and quantity strings', () => {
    expect(ok(zMoney, '5545000.00')).toBe(true);
    expect(ok(zMoney, '1.234')).toBe(false);
    expect(ok(zMoney, '1e5')).toBe(false);
    expect(ok(zMoneyPos, '-1')).toBe(false);
    expect(ok(zQty, '1250.000')).toBe(true);
    expect(ok(zQty, '1.2345')).toBe(false);
  });

  it('BR-DQ-02: CNIC 13 digits, dashes stripped', () => {
    expect(zCnic.parse('42101-1234567-8')).toBe('4210112345678');
    expect(ok(zCnic, '42101-1234567')).toBe(false);
  });

  it('BR-DQ-02: NTN 7–8 digits with optional check digit; STRN 13 digits', () => {
    expect(zNtn.parse('2876543-1')).toBe('2876543-1');
    expect(ok(zNtn, '12345')).toBe(false);
    expect(zStrn.parse('32-77-6543-210-91')).toBe('3277654321091');
    expect(ok(zStrn, '32-77-6543')).toBe(false);
  });

  it('BR-DQ-02: mobile normalised to 03XXXXXXXXX', () => {
    expect(zMobile.parse('0300-8214567')).toBe('03008214567');
    expect(zMobile.parse('+92 300 8214567')).toBe('03008214567');
    expect(ok(zMobile, '021-35081234')).toBe(false);
  });

  it('BR-CUS-05: WhatsApp stored as 92XXXXXXXXXX', () => {
    expect(zWhatsapp.parse('0300-8214567')).toBe('923008214567');
    expect(zWhatsapp.parse('+923008214567')).toBe('923008214567');
  });

  it('BR-GATE-02: vehicle number upper-case without spaces', () => {
    expect(zVehicleNo.parse('tle 4786')).toBe('TLE4786');
    expect(zVehicleNo.parse('tle-4786')).toBe('TLE-4786');
    expect(ok(zVehicleNo, 'ab')).toBe(false);
  });

  it('BR-AUD-02: reason is at least 10 characters', () => {
    expect(ok(zReason, 'too short')).toBe(false);
    expect(ok(zReason, 'Customer asked to cancel')).toBe(true);
  });
});
