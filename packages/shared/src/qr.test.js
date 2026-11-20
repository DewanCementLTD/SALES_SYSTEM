import { describe, expect, it } from 'vitest';
import { parseQr, signQr, verifyQr } from './qr.js';

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
