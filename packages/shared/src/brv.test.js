import { describe, expect, it } from 'vitest';
import { BRV_RETURN_CD, canVerify, checkTransition, zBrvBody, zBrvVerify } from './index.js';

const body = (o = {}) => ({
  brvDate: '2026-11-23',
  customerCode: '102-04',
  instCode: 'N',
  depositAccount: 'HBL',
  amount: '500000',
  ...o,
});

describe('BRV (P2-04)', () => {
  it('BR-BRV-01: entry needs instrument, company account and a positive amount', () => {
    expect(zBrvBody.safeParse(body()).success).toBe(true);
    expect(zBrvBody.safeParse(body({ amount: '0' })).success).toBe(false);
    expect(zBrvBody.safeParse(body({ depositAccount: '' })).success).toBe(false);
    expect(zBrvBody.safeParse(body({ amount: '12.345' })).success).toBe(false);
  });

  it('BR-BRV-02: ENTERED → VERIFIED → CLEARED; bounce only after verification', () => {
    expect(checkTransition('BRV', 'ENTERED', 'VERIFIED').ok).toBe(true);
    expect(checkTransition('BRV', 'VERIFIED', 'CLEARED').ok).toBe(true);
    expect(checkTransition('BRV', 'CLEARED', 'BOUNCED').ok).toBe(true);
    expect(checkTransition('BRV', 'ENTERED', 'BOUNCED').ok).toBe(false);
    expect(checkTransition('BRV', 'VERIFIED', 'CANCELLED').ok).toBe(false);
    expect(BRV_RETURN_CD).toMatchObject({ CLEARED: 'C', BOUNCED: 'R', ENTERED: 'P' });
  });

  it('BR-BRV-03: maker cannot verify; method and bank reference are required', () => {
    expect(canVerify({ createdBy: 'FIN01' }, 'fin01').ok).toBe(false);
    expect(canVerify({ createdBy: 'FIN01' }, 'FIN02').ok).toBe(true);
    expect(zBrvVerify.safeParse({ method: 'PHONE', bankRef: 'x' }).success).toBe(false);
    expect(zBrvVerify.safeParse({ method: 'FAX', bankRef: 'ref 1' }).success).toBe(false);
    expect(zBrvVerify.safeParse({ method: 'BANK_PORTAL', bankRef: 'ref 1' }).success).toBe(true);
  });
});
