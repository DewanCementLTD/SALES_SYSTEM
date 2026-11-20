import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  P,
  expandPermissions,
  hasPermission,
  isPermissionKey,
} from './permissions.js';

describe('permissions (PERMISSIONS §1)', () => {
  it('keys are unique and module.action shaped, ≤ 60 chars (APP_PERMISSION.PERM_KEY)', () => {
    const keys = ALL_PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) {
      expect(k).toMatch(/^[a-z]+\.[a-z0-9_]+$/);
      expect(k.length).toBeLessThanOrEqual(60);
    }
  });

  it('exposes typed constants', () => {
    expect(P.oc.confirm).toBe('oc.confirm');
    expect(P.report.r13).toBe('report.r13');
    expect(isPermissionKey('gate.exit_override')).toBe(true);
    expect(isPermissionKey('gate.fly')).toBe(false);
  });

  it('marks override/approve/cancel rights as sensitive', () => {
    const s = Object.fromEntries(ALL_PERMISSIONS.map((p) => [p.key, p.sensitive]));
    expect(s['oc.balance_override']).toBe(true);
    expect(s['customer.approve']).toBe(true);
    expect(s['weigh.manual']).toBe(true);
    expect(s['oc.view']).toBe(false);
  });

  it('expands wildcards and checks grants', () => {
    const oc = expandPermissions(['oc.*']);
    expect(oc).toContain('oc.confirm');
    expect(oc.every((k) => k.startsWith('oc.'))).toBe(true);
    expect(hasPermission(['oc.*'], 'oc.cancel')).toBe(true);
    expect(hasPermission(['oc.view'], 'oc.cancel')).toBe(false);
    expect(() => expandPermissions(['oc.fly'])).toThrow();
  });
});
