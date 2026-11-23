import { describe, expect, it } from 'vitest';
import { gateCheck, offlineQrCheck, parseQr, qrSignature, signQr, verifyQr } from './qr.js';

const SECRET = 'test-secret-for-qr-signing-only';

describe('signed QR (BR-QR-01..03)', () => {
  it('BR-QR-01: payload format DCL|type|brnch|no|ver|sig with 16-byte base64url signature', async () => {
    const p = await signQr({ docType: 'DO', brnch: 1, docNo: '22702000001', ver: 1 }, SECRET);
    const parts = p.split('|');
    expect(parts.slice(0, 5)).toEqual(['DCL', 'DO', '1', '22702000001', '1']);
    expect(parts[5]).toMatch(/^[A-Za-z0-9_-]{22}$/); // 16 bytes → 22 base64url chars
  });

  it('BR-QR-02: valid signature verifies; tampered payload is rejected', async () => {
    const p = await signQr({ docType: 'PMT', brnch: 2, docNo: '2027746', ver: 3 }, SECRET);
    await expect(verifyQr(p, SECRET)).resolves.toEqual({
      ok: true,
      doc: { docType: 'PMT', brnch: 2, docNo: '2027746', ver: 3 },
    });
    const tampered = p.replace('|2027746|', '|2027747|');
    await expect(verifyQr(tampered, SECRET)).resolves.toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
    await expect(verifyQr(p, 'other-secret')).resolves.toMatchObject({ reason: 'BAD_SIGNATURE' });
  });

  it('BR-QR-03: a new version gives a different payload', async () => {
    const v1 = await signQr({ docType: 'DO', brnch: 1, docNo: '5', ver: 1 }, SECRET);
    const v2 = await signQr({ docType: 'DO', brnch: 1, docNo: '5', ver: 2 }, SECRET);
    expect(v1).not.toBe(v2);
    expect(parseQr(v2).ver).toBe(2);
  });

  it('rejects malformed input', async () => {
    expect(parseQr('hello')).toBeNull();
    expect(parseQr('DCL|XX|1|5|1|sig')).toBeNull();
    await expect(verifyQr('DCL|DO|1|5', SECRET)).resolves.toEqual({
      ok: false,
      reason: 'MALFORMED',
    });
    await expect(signQr({ docType: 'DO', brnch: 3, docNo: '5', ver: 1 }, SECRET)).rejects.toThrow();
  });
});

describe('gate checks of a QR (BR-QR-02/03, BR-OFF-02)', () => {
  const secret = 'test-qr-secret-0001';
  const doc = { docType: 'DO', brnch: 1, docNo: 'OS-22702003944', ver: 2 };
  it('BR-OFF-02: offline check uses the cached signature, no secret needed', async () => {
    const qr = await signQr(doc, secret);
    const sig = await qrSignature(doc, secret);
    const entries = [{ docType: 'DO', docNo: 'OS-22702003944', ver: 2, sig, status: 'ISSUED' }];
    expect(offlineQrCheck(qr, entries, 1)).toMatchObject({ ok: true });
    const forged = `${qr.slice(0, -4)}AAAA`;
    expect(offlineQrCheck(forged, entries, 1).reason).toBe('BAD_SIGNATURE');
    expect(offlineQrCheck('hello', entries, 1).reason).toBe('MALFORMED');
    expect(offlineQrCheck(qr, entries, 2).reason).toBe('WRONG_BRANCH');
    expect(offlineQrCheck(qr, [], 1).reason).toBe('UNKNOWN');
  });
  it('BR-QR-03: an old print (lower version) is refused; held and closed documents too', async () => {
    const old = await signQr({ ...doc, ver: 1 }, secret);
    const sig1 = await qrSignature({ ...doc, ver: 1 }, secret);
    const snap = (status, ver = 2, sig) => ({ brnch: 1, ver, status, sig });
    const parsed = { ...parseQr(old) };
    expect(gateCheck(parsed, snap('ISSUED', 2), 1)).toMatchObject({
      reason: 'OLD_VERSION',
      ruleId: 'BR-QR-03',
    });
    expect(gateCheck(parsed, snap('ON_HOLD', 1, sig1), 1).reason).toBe('ON_HOLD');
    expect(gateCheck(parsed, snap('CANCELLED', 1), 1).reason).toBe('NOT_OPEN');
    expect(gateCheck(parsed, snap('PARTLY_DISPATCHED', 1), 1).ok).toBe(true);
  });
});
