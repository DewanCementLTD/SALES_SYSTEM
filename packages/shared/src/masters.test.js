import { describe, expect, it } from 'vitest';
import { MASTERS, MASTER_TYPES, masterBodySchema, masterKeyOf, parseMasterKey } from './masters.js';

describe('master registry (P1-01)', () => {
  it('every master has a unique type, a key and SQL names within 30 chars', () => {
    expect(new Set(MASTER_TYPES).size).toBe(MASTER_TYPES.length);
    for (const def of Object.values(MASTERS)) {
      expect(def.key.length).toBeGreaterThan(0);
      for (const f of [...def.key, ...def.fields]) {
        expect(f.col).toMatch(/^[A-Z][A-Z0-9_#]{0,29}$/);
        if (f.kind === 'ref') expect(f.ref).toBeTruthy();
      }
      expect([...def.key, ...def.fields].some((f) => f.name === def.labelField)).toBe(true);
    }
  });

  it('refs point at a master or a derived lookup', () => {
    for (const def of Object.values(MASTERS))
      for (const f of def.fields.filter((x) => x.kind === 'ref'))
        expect([...MASTER_TYPES, 'product-codes']).toContain(f.ref);
  });

  it('product periods are read-only (BR-PRC-01, BR-TAX-10: new period = new row via P1-05)', () => {
    expect(MASTERS['product-periods'].readOnly).toBe(true);
    expect(MASTERS['product-periods'].hasActive).toBe(false);
  });

  it('composite keys round-trip through the URL form', () => {
    const def = MASTERS['product-periods'];
    const key = masterKeyOf(def, { productCode: 'OPC', period: 57 });
    expect(key).toBe('OPC~57');
    expect(parseMasterKey(def, key)).toEqual({ productCode: 'OPC', period: 57 });
    expect(parseMasterKey(def, 'OPC')).toBeNull();
    expect(parseMasterKey(def, 'OPC~x')).toBeNull();
  });

  it('create schema upper-cases codes, rejects bad characters and requires names', () => {
    const s = masterBodySchema(MASTERS.channels, 'create');
    expect(s.parse({ channelCode: ' 010 ', description: 'Retail' })).toMatchObject({
      channelCode: '010',
      description: 'Retail',
    });
    expect(s.safeParse({ channelCode: 'a b', description: 'x' }).success).toBe(false);
    expect(s.safeParse({ channelCode: '011', description: '' }).success).toBe(false);
    expect(s.safeParse({ channelCode: '011', description: 'x', reportGroup: 'NOPE' }).success).toBe(
      false,
    );
  });

  it('auto keys may be left empty on create; update has no key fields', () => {
    const c = masterBodySchema(MASTERS.bags, 'create');
    expect(c.parse({ bagCode: '', description: 'PP bag' }).bagCode).toBeNull();
    const u = masterBodySchema(MASTERS.bags, 'update');
    expect(Object.keys(u.shape)).not.toContain('bagCode');
  });

  it('decimal fields travel as strings', () => {
    const s = masterBodySchema(MASTERS['company-banks'], 'update');
    const base = { name: 'X', branchName: 'Y', account: '1' };
    expect(s.parse({ ...base, returnCharges: '250.50' }).returnCharges).toBe('250.50');
    expect(s.safeParse({ ...base, returnCharges: '12,5' }).success).toBe(false);
  });
});
