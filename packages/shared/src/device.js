// Plant devices (ARCHITECTURE §7, PERMISSIONS P-6, TASKS P3-01): weighbridge agents and gate
// tablets authenticate with device id + secret. The secret never travels: the device signs a
// canonical string with HMAC-SHA256 (full 32 bytes, base64url). Used for the token request and,
// later, for every weighbridge reading (BR-WGT-01). Web Crypto: same code in the agent and the API.
import { z } from 'zod';

export const DEVICE_TYPES = Object.freeze(['WEIGHBRIDGE', 'GATE']);
/** Token request may be this far from server time (replay window). */
export const DEVICE_CLOCK_SKEW_SEC = 300;

const enc = new TextEncoder();

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** HMAC-SHA256(secret, text) → base64url. */
export async function deviceHmac(secret, text) {
  if (!secret) throw new Error('Device secret missing');
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toBase64Url(
    new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(text))),
  );
}

function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Canonical text of a token request. */
export const tokenRequestText = ({ deviceId, ts, nonce }) => `DCL-DEV|${deviceId}|${ts}|${nonce}`;

/** Canonical text of a weighbridge reading (BR-WGT-01; the agent signs each capture). */
export const readingText = ({ deviceId, readingId, weightKg, stable, readOn }) =>
  `DCL-WGT|${deviceId}|${readingId}|${weightKg}|${stable ? 1 : 0}|${readOn}`;

/** Device side: a signed token request for now. */
export async function signTokenRequest(deviceId, secret, now = new Date(), nonce = undefined) {
  const n = nonce ?? toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(12)));
  const req = { deviceId, ts: now.toISOString(), nonce: n };
  return { ...req, signature: await deviceHmac(secret, tokenRequestText(req)) };
}

/**
 * Server side: check a token request. Returns { ok } or { ok: false, reason }.
 * @param {{ deviceId: string, ts: string, nonce: string, signature: string }} req
 */
export async function verifyTokenRequest(req, secret, now) {
  const t = Date.parse(req.ts);
  if (Number.isNaN(t)) return { ok: false, reason: 'bad timestamp' };
  if (Math.abs(now.getTime() - t) > DEVICE_CLOCK_SKEW_SEC * 1000)
    return { ok: false, reason: 'device clock is off by more than 5 minutes' };
  const want = await deviceHmac(secret, tokenRequestText(req));
  return sameText(want, req.signature) ? { ok: true } : { ok: false, reason: 'bad signature' };
}

/** Check a signature over any canonical text (weigh readings). */
export async function verifyDeviceSignature(secret, text, signature) {
  return sameText(await deviceHmac(secret, text), signature);
}

/** Random device secret (shown once to the administrator). */
export function newDeviceSecret() {
  return toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

const zDeviceId = z
  .string()
  .trim()
  .regex(
    /^[A-Z0-9][A-Z0-9-]{2,39}$/,
    'Device id: capitals, digits and dashes (3–40), e.g. KHI-WB-01',
  );

export const zDeviceTokenRequest = z.object({
  deviceId: zDeviceId,
  ts: z.string().max(40),
  nonce: z.string().min(8).max(64),
  signature: z.string().min(20).max(100),
});

/** Admin create / edit (config = parser profile, port, stable rule: free JSON object). */
export const zDeviceCreate = z.object({
  deviceId: zDeviceId,
  brnch: z.number().int(),
  deviceType: z.enum(DEVICE_TYPES),
  deviceName: z.string().trim().min(2).max(100),
  config: z.record(z.string(), z.unknown()).optional(),
});
export const zDeviceUpdate = z.object({
  deviceName: z.string().trim().min(2).max(100),
  active: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
});
