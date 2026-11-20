// Signed QR payloads (BR-QR-01..03). Format: DCL|<doctype>|<brnch>|<docno>|<ver>|<sig>
// sig = first 16 bytes of HMAC-SHA256 over "DCL|<doctype>|<brnch>|<docno>|<ver>", base64url.
// Uses Web Crypto so the same code runs in Node (API) and the plant PWA (offline check, BR-OFF-02).

export const QR_DOC_TYPES = Object.freeze(['DO', 'PMT', 'GP', 'INV']);
const PREFIX = 'DCL';
const SIG_BYTES = 16;

const enc = new TextEncoder();

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret, text) {
  if (!secret) throw new Error('QR secret missing');
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(text)));
  return toBase64Url(sig.slice(0, SIG_BYTES));
}

function body({ docType, brnch, docNo, ver }) {
  if (!QR_DOC_TYPES.includes(docType)) throw new Error(`Bad QR doc type ${docType}`);
  if (![1, 2].includes(Number(brnch))) throw new Error(`Bad branch ${brnch}`);
  if (!/^[0-9A-Za-z.\-/]+$/.test(String(docNo))) throw new Error(`Bad doc no ${docNo}`);
  if (!Number.isInteger(Number(ver)) || Number(ver) < 1) throw new Error(`Bad version ${ver}`);
  return `${PREFIX}|${docType}|${Number(brnch)}|${docNo}|${Number(ver)}`;
}

/**
 * BR-QR-01: build the signed payload.
 * @param {{ docType: string, brnch: number, docNo: string|number, ver: number }} doc
 * @param {string} secret
 */
export async function signQr(doc, secret) {
  const b = body(doc);
  return `${b}|${await hmac(secret, b)}`;
}

/** Split a payload without checking the signature. Returns null when malformed. */
export function parseQr(payload) {
  if (typeof payload !== 'string') return null;
  const parts = payload.trim().split('|');
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;
  const [, docType, brnch, docNo, ver, sig] = parts;
  if (!QR_DOC_TYPES.includes(docType) || !/^\d+$/.test(brnch) || !/^\d+$/.test(ver)) return null;
  return { docType, brnch: Number(brnch), docNo, ver: Number(ver), sig };
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify signature (BR-QR-02 first check). Document state, branch and version checks (BR-QR-02/03)
 * are done by the caller against the database or offline cache.
 * @returns {Promise<{ ok: true, doc: object } | { ok: false, reason: 'MALFORMED'|'BAD_SIGNATURE' }>}
 */
export async function verifyQr(payload, secret) {
  const doc = parseQr(payload);
  if (!doc) return { ok: false, reason: 'MALFORMED' };
  const expected = await hmac(secret, body(doc));
  if (!safeEqual(expected, doc.sig)) return { ok: false, reason: 'BAD_SIGNATURE' };
  const { sig: _sig, ...rest } = doc;
  return { ok: true, doc: rest };
}
