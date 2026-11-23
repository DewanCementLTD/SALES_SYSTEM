// Access tokens (JWT HS256, 15 min) and opaque refresh tokens (stored as sha256, 12 h sliding).
// API_SPEC §1: cookies `at` (access), `rt` (refresh), `csrf` (double submit, readable by JS).
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export const ACCESS_TTL_SEC = 15 * 60;
export const REFRESH_TTL_SEC = 12 * 60 * 60;
export const COOKIE = Object.freeze({ access: 'at', refresh: 'rt', csrf: 'csrf' });
const ISSUER = 'dcl-sales';

/**
 * @typedef {{ userId: number, usrid: string, brnch: number, fiscalYear: number, mustChangePassword: boolean }} AccessClaims
 */

const keyOf = (secret) => new TextEncoder().encode(secret);

/** @param {AccessClaims} c @param {string} secret @param {Date} now */
export function signAccessToken(c, secret, now) {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ usr: c.usrid, brn: c.brnch, fy: c.fiscalYear, mcp: c.mustChangePassword })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(c.userId))
    .setIssuer(ISSUER)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TTL_SEC)
    .sign(keyOf(secret));
}

/** @returns {Promise<AccessClaims|null>} null when invalid or expired */
export async function verifyAccessToken(token, secret, now) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), {
      issuer: ISSUER,
      algorithms: ['HS256'],
      currentDate: now,
    });
    if (payload.aud !== undefined) return null; // a device token is not a user session (P-6)
    return {
      userId: Number(payload.sub),
      usrid: String(payload.usr),
      brnch: Number(payload.brn),
      fiscalYear: Number(payload.fy),
      mustChangePassword: Boolean(payload.mcp),
    };
  } catch {
    return null;
  }
}

export const newRefreshToken = () => randomBytes(32).toString('base64url');
export const newFamilyId = () => randomUUID();
export const newCsrfToken = () => randomBytes(24).toString('base64url');
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Constant-time string compare (CSRF). */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// Device tokens (ARCHITECTURE §7, PERMISSIONS P-6): JWT HS256 with its own audience, so a device
// token is never accepted as a user session and the reverse.
export const DEVICE_TTL_SEC = 12 * 60 * 60;
const DEVICE_AUD = 'dcl-device';

/** @param {{ deviceId: string, brnch: number, deviceType: string }} d */
export function signDeviceToken(d, secret, now) {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ brn: d.brnch, dty: d.deviceType })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(d.deviceId)
    .setIssuer(ISSUER)
    .setAudience(DEVICE_AUD)
    .setIssuedAt(iat)
    .setExpirationTime(iat + DEVICE_TTL_SEC)
    .sign(keyOf(secret));
}

/** @returns {Promise<{ deviceId: string, brnch: number, deviceType: string }|null>} */
export async function verifyDeviceToken(token, secret, now) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), {
      issuer: ISSUER,
      audience: DEVICE_AUD,
      algorithms: ['HS256'],
      currentDate: now,
    });
    return {
      deviceId: String(payload.sub),
      brnch: Number(payload.brn),
      deviceType: String(payload.dty),
    };
  } catch {
    return null;
  }
}
