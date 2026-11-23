import { describe, expect, it } from 'vitest';
import {
  deviceHmac,
  newDeviceSecret,
  readingText,
  signTokenRequest,
  verifyDeviceSignature,
  verifyTokenRequest,
  zDeviceCreate,
} from './device.js';

const now = new Date('2026-11-24T05:00:00Z');
const secret = 'device-secret-for-tests-0001';

describe('device signatures (P3-01)', () => {
  it('a signed token request verifies; another secret or a changed field does not', async () => {
    const req = await signTokenRequest('KHI-WB-01', secret, now, 'nonce-0001');
    expect(req).toMatchObject({
      deviceId: 'KHI-WB-01',
      ts: now.toISOString(),
      nonce: 'nonce-0001',
    });
    expect(await verifyTokenRequest(req, secret, now)).toEqual({ ok: true });
    expect((await verifyTokenRequest(req, 'other-secret-xxxxxxxx', now)).ok).toBe(false);
    expect((await verifyTokenRequest({ ...req, deviceId: 'KHI-WB-02' }, secret, now)).ok).toBe(
      false,
    );
  });
  it('requests older or newer than 5 minutes are refused (replay window)', async () => {
    const req = await signTokenRequest('KHI-WB-01', secret, now, 'nonce-0001');
    const later = new Date(now.getTime() + 301_000);
    expect(await verifyTokenRequest(req, secret, later)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/clock/),
    });
  });
  it('BR-WGT-01: a reading signature covers id, weight, stable flag and time', async () => {
    const r = {
      deviceId: 'KHI-WB-01',
      readingId: 'r-1',
      weightKg: 41250,
      stable: true,
      readOn: now.toISOString(),
    };
    const sig = await deviceHmac(secret, readingText(r));
    expect(await verifyDeviceSignature(secret, readingText(r), sig)).toBe(true);
    expect(await verifyDeviceSignature(secret, readingText({ ...r, weightKg: 41260 }), sig)).toBe(
      false,
    );
  });
  it('secrets are random 43-character strings; device ids are validated', () => {
    const a = newDeviceSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newDeviceSecret()).not.toBe(a);
    const base = { brnch: 1, deviceType: 'WEIGHBRIDGE', deviceName: 'Weighbridge 1' };
    expect(zDeviceCreate.safeParse({ ...base, deviceId: 'KHI-WB-01' }).success).toBe(true);
    expect(zDeviceCreate.safeParse({ ...base, deviceId: 'khi wb' }).success).toBe(false);
  });
});
