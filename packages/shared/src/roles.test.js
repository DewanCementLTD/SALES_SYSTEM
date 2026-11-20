import { describe, expect, it } from 'vitest';
import { ROLES } from './roles.js';

const perms = (code) => new Set(ROLES.find((r) => r.code === code).permissions);

// Spot checks of PERMISSIONS §3 (full matrix fixture is exercised again by the API RBAC test).
describe('role matrix (PERMISSIONS §3)', () => {
  it.each([
    ['FINANCE', 'oc.confirm', true],
    ['MARKETING', 'oc.confirm', false],
    ['MARKETING', 'srf.cancel', true],
    ['FINANCE', 'srf.create', false],
    ['FINANCE', 'brv.verify', true],
    ['SALES_MANAGER', 'brv.verify', false],
    ['CFO', 'permit.cfo_approve', true],
    ['FINANCE_MANAGER', 'permit.cfo_approve', false],
    ['CUSTOMER_APPROVER', 'customer.approve', true],
    ['SALES_MANAGER', 'customer.approve', false],
    ['GATE_OPERATOR', 'dc.print', true],
    ['GATE_OPERATOR', 'dc.update', false],
    ['WEIGH_OPERATOR', 'weigh.manual', false],
    ['DISPATCH_SUPERVISOR', 'weigh.manual', true],
    ['MARKETING', 'report.r2', false],
    ['MARKETING', 'report.r13', true],
    ['PLANT_MANAGER', 'report.r12', true],
    ['DISPATCH_SUPERVISOR', 'report.r12', false],
    ['AUDITOR', 'invoice.print', false],
    ['AUDITOR', 'audit.view', true],
    ['SYS_ADMIN', 'admin.roles', true],
    ['SYS_ADMIN', 'oc.view', false],
    ['MANAGEMENT', 'approval.inbox', false],
  ])('%s has %s = %s', (role, key, expected) => {
    expect(perms(role).has(key)).toBe(expected);
  });

  it('role codes fit APP_ROLE.ROLE_CODE (≤ 30)', () => {
    for (const r of ROLES) expect(r.code.length).toBeLessThanOrEqual(30);
    expect(ROLES).toHaveLength(14);
  });
});
