import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto.js';

const key = Buffer.alloc(32, 7).toString('base64');

describe('secrets at rest (AES-256-GCM)', () => {
  it('round-trips, uses a new IV each time, and refuses a changed ciphertext or key', () => {
    const a = encryptSecret('s3cret-value', key);
    const b = encryptSecret('s3cret-value', key);
    expect(a).not.toBe(b);
    expect(a.startsWith('v1.')).toBe(true);
    expect(decryptSecret(a, key)).toBe('s3cret-value');
    const parts = a.split('.');
    parts[3] = `${parts[3].slice(0, -2)}AA`;
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
    expect(() => decryptSecret(a, Buffer.alloc(32, 9).toString('base64'))).toThrow();
    expect(() => decryptSecret('plain', key)).toThrow(/format/);
  });
});
