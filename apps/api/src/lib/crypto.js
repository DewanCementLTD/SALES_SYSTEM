// Secrets at rest (ARCHITECTURE §7): AES-256-GCM with APP_ENC_KEY (32 bytes, base64). Used for
// device secrets now; SMTP/FBR credentials later. Format: `v1.<iv>.<tag>.<ciphertext>` (base64url).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const keyOf = (b64) => {
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) throw new Error('APP_ENC_KEY must be 32 bytes');
  return k;
};

/** @param {string} plain @param {string} keyB64 */
export function encryptSecret(plain, keyB64) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyOf(keyB64), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv, c.getAuthTag(), ct]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

/** @param {string} stored @param {string} keyB64 @returns {string} */
export function decryptSecret(stored, keyB64) {
  const [v, iv, tag, ct] = String(stored).split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unknown secret format');
  const d = createDecipheriv('aes-256-gcm', keyOf(keyB64), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
