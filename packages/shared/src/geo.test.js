import { describe, expect, it } from 'vitest';
import { childGeoCode, isGeoWithin, parseGeoCode, zGeoCreate } from './geo.js';

describe('geography codes (SCHEMA §2.3, P1-02)', () => {
  it('parses a city path into its level codes', () => {
    expect(parseGeoCode('Z1-T12-A1-C389')).toEqual({
      level: 4,
      zone: '1',
      territory: '12',
      area: '1',
      city: '389',
    });
    expect(parseGeoCode('Z0')).toMatchObject({ level: 1, zone: '0', territory: null });
  });

  it('rejects malformed paths', () => {
    for (const bad of ['', 'T1', 'Z1-A1', 'Z1-T1-A1-C1-X1', 'Z-T1', 'Z1-t1', 'Z1-T1.2'])
      expect(parseGeoCode(bad)).toBeNull();
  });

  it('builds child codes level by level', () => {
    expect(childGeoCode(null, '9')).toBe('Z9');
    expect(childGeoCode('Z9', 'K1')).toBe('Z9-TK1');
    expect(childGeoCode('Z9-TK1', '01')).toBe('Z9-TK1-A01');
    expect(childGeoCode('Z9-TK1-A01', '700')).toBe('Z9-TK1-A01-C700');
    expect(() => childGeoCode('Z9-TK1-A01-C700', '1')).toThrow();
  });

  it('knows descendants without matching a sibling prefix', () => {
    expect(isGeoWithin('Z1-T12-A1', 'Z1-T12')).toBe(true);
    expect(isGeoWithin('Z1-T12', 'Z1-T12')).toBe(true);
    expect(isGeoWithin('Z1-T123', 'Z1-T12')).toBe(false);
  });

  it('create body upper-cases the code and treats an empty parent as a zone', () => {
    expect(zGeoCreate.parse({ parentCode: '', code: 'k1', name: 'Korangi' })).toEqual({
      parentCode: null,
      code: 'K1',
      name: 'Korangi',
    });
    expect(zGeoCreate.safeParse({ code: 'K-1', name: 'x y' }).success).toBe(false);
  });
});
