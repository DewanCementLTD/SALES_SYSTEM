import { describe, expect, it } from 'vitest';
import { STATE_MACHINES, canTransition, checkTransition, isTerminal } from './enums.js';

describe('state machines (BUSINESS_RULES §12)', () => {
  it('every target status is a known status of the same machine', () => {
    for (const [name, table] of Object.entries(STATE_MACHINES)) {
      for (const [from, targets] of Object.entries(table)) {
        for (const to of targets) {
          expect(table[to], `${name}: ${from} → ${to}`).toBeDefined();
        }
      }
    }
  });

  it.each([
    ['CUSTOMER', 'DRAFT', 'PENDING_APPROVAL', true],
    ['CUSTOMER', 'DRAFT', 'APPROVED', false],
    ['CUSTOMER', 'APPROVED', 'BLOCKED', true],
    ['CUSTOMER', 'BLOCKED', 'APPROVED', true],
    ['SRF', 'SUBMITTED', 'CONVERTED', true],
    ['SRF', 'CONVERTED', 'CANCELLED', false],
    ['OC', 'DRAFT', 'CONFIRMED', false],
    ['OC', 'APPROVED', 'CONFIRMED', true],
    ['OC', 'REVIEWED', 'DRAFT', true],
    ['OC', 'CONFIRMED', 'CANCELLED', true],
    ['BRV', 'ENTERED', 'VERIFIED', true],
    ['BRV', 'VERIFIED', 'CANCELLED', false],
    ['BRV', 'VERIFIED', 'BOUNCED', true],
    ['PERMIT', 'DRAFT', 'PENDING_CFO', true],
    ['PERMIT', 'PENDING_CFO', 'PARTLY_DISPATCHED', false],
    ['DO', 'ON_HOLD', 'PARTLY_DISPATCHED', true],
    ['DO', 'DISPATCHED', 'CANCELLED', false],
    ['GATE_PASS', 'IN', 'GROSS_DONE', false],
    ['GATE_PASS', 'GROSS_DONE', 'VARIANCE_BLOCKED', true],
    ['GATE_PASS', 'VARIANCE_BLOCKED', 'INVOICED', false],
    ['GATE_PASS', 'INVOICED', 'EXITED', true],
    ['DC', 'FBR_DONE', 'CANCELLED', false],
    ['INVOICE', 'FBR_ACCEPTED', 'CANCELLED', false],
    ['NOTE', 'POSTED', 'REVERSED', true],
    ['APPROVAL', 'APPROVED', 'REJECTED', false],
  ])('%s: %s → %s allowed = %s', (m, from, to, ok) => {
    expect(canTransition(m, from, to)).toBe(ok);
  });

  it('BR-DC-CXL-02/03: DC cancel allowed before FBR, blocked after FBR number', () => {
    expect(canTransition('DC', 'INVOICED', 'CANCELLED')).toBe(true);
    expect(canTransition('DC', 'FBR_DONE', 'CANCELLED')).toBe(false);
  });

  it('checkTransition explains a refused change', () => {
    expect(checkTransition('OC', 'CLOSED', 'DRAFT')).toEqual({
      ok: false,
      code: 'INVALID_STATE',
      detail: 'OC cannot change from CLOSED to DRAFT',
    });
  });

  it('terminal statuses have no exits', () => {
    expect(isTerminal('BRV', 'BOUNCED')).toBe(true);
    expect(isTerminal('BRV', 'ENTERED')).toBe(false);
  });

  it('unknown machine throws', () => {
    expect(() => canTransition('NOPE', 'A', 'B')).toThrow();
  });
});
