import { describe, expect, it } from 'vitest';
import {
  approvalFieldsIn,
  canTrade,
  customerCode,
  customerCodePrefix,
  customerStatus,
  nextCustomerSeq,
  zCustomerCreate,
  zCustomerPatch,
} from './customers.js';

describe('customers (BR-CUS)', () => {
  it('BR-CUS-03: one-character zone gives Z-TT-AA-NNN (11 chars)', () => {
    const p = customerCodePrefix({ zone: '9', territory: '2', area: '1' });
    expect(p).toBe('9-02-01-');
    expect(customerCode(p, 3)).toBe('9-02-01-003');
    expect(customerCode(p, 3)).toHaveLength(11);
  });

  it('BR-CUS-03: two-character zone gives ZZTT-AA-NNN like legacy Hattar (1001-21-001)', () => {
    const p = customerCodePrefix({ zone: '10', territory: '01', area: '21' });
    expect(customerCode(p, 1)).toBe('1001-21-001');
  });

  it('BR-CUS-03: codes that cannot fit are refused', () => {
    expect(() => customerCodePrefix({ zone: '100', territory: '1', area: '1' })).toThrow();
    expect(() => customerCodePrefix({ zone: '1', territory: '123', area: '1' })).toThrow();
    expect(() => customerCode('9-02-01-', 1000)).toThrow(/max 999/);
  });

  it('BR-CUS-03: next sequence follows the highest numeric code under the prefix', () => {
    expect(nextCustomerSeq('9-02-01-', ['9-02-01-001', '9-02-01-007', '9-02-011-01', 'x'])).toBe(8);
    expect(nextCustomerSeq('9-02-01-', [])).toBe(1);
  });

  it('legacy customers without DOC_STATUS count as approved unless closed', () => {
    expect(customerStatus({ docStatus: null, closed: 'N' })).toBe('APPROVED');
    expect(customerStatus({ docStatus: null, closed: 'Y' })).toBe('CLOSED');
    expect(customerStatus({ docStatus: 'PENDING_APPROVAL', closed: 'N' })).toBe('PENDING_APPROVAL');
  });

  it('BR-CUS-01/08: only approved, active, unblocked customers can trade', () => {
    expect(canTrade({ status: 'APPROVED', active: true })).toEqual({ ok: true });
    expect(canTrade({ status: 'PENDING_APPROVAL', active: true }).ok).toBe(false);
    expect(canTrade({ status: 'BLOCKED', active: true }).ok).toBe(false);
    expect(canTrade({ status: 'CLOSED', active: true }).ok).toBe(false);
    expect(canTrade({ status: 'APPROVED', active: false }).ok).toBe(false);
  });

  it('BR-CUS-05: contacts are normalised (WhatsApp 92…, mobile 03…, CNIC digits)', () => {
    const v = zCustomerPatch.parse({
      whatsappNo: '0300-1234567',
      mobile: '+92 300 1234567',
      cnic: '42101-1234567-1',
      email: 'Sales@Example.PK',
    });
    expect(v).toEqual({
      whatsappNo: '923001234567',
      mobile: '03001234567',
      cnic: '4210112345671',
      email: 'sales@example.pk',
    });
    expect(zCustomerPatch.safeParse({ whatsappNo: '12345' }).success).toBe(false);
  });

  it('patch keeps untouched fields out and refuses unknown or emptied required fields', () => {
    expect(zCustomerPatch.parse({ address1: 'Shop 4' })).toEqual({ address1: 'Shop 4' });
    expect(zCustomerPatch.safeParse({ customerName: '' }).success).toBe(false);
    expect(zCustomerPatch.safeParse({ nope: 1 }).success).toBe(false);
  });

  it('create needs name, channel and a geography node', () => {
    expect(zCustomerCreate.safeParse({ customerName: 'A' }).success).toBe(false);
    expect(
      zCustomerCreate.safeParse({ customerName: 'A B', channelCode: '001', geoCode: 'Z1-T1-A01' })
        .success,
    ).toBe(true);
  });

  it('BR-CUS-02: tax and contact-number fields need approval; address does not', () => {
    expect(approvalFieldsIn({ address1: 'x', ntn: '1234567', mobile: '03001234567' })).toEqual([
      'ntn',
      'mobile',
    ]);
  });
});
