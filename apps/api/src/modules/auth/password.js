// Password hashing (argon2id) and policy (PRD 4.1).
import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

// OWASP 2023+ argon2id baseline: m=19 MiB, t=2, p=1
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 };

export const hashPassword = (plain) => hash(plain, OPTS);

export async function verifyPassword(stored, plain) {
  if (!stored) return false;
  try {
    return await verify(stored, plain);
  } catch {
    return false;
  }
}

/**
 * Password policy: min length (PWD_MIN_LENGTH [10]), upper, lower, digit; not containing the user id.
 * @returns {string[]} problems (empty = OK)
 */
export function passwordProblems(plain, { minLength = 10, usrid = '' } = {}) {
  const p = [];
  if (typeof plain !== 'string' || plain.length < minLength)
    p.push(`at least ${minLength} characters`);
  if (!/[A-Z]/.test(plain ?? '')) p.push('an upper-case letter');
  if (!/[a-z]/.test(plain ?? '')) p.push('a lower-case letter');
  if (!/\d/.test(plain ?? '')) p.push('a digit');
  if (
    usrid &&
    String(plain ?? '')
      .toLowerCase()
      .includes(usrid.toLowerCase())
  )
    p.push('not contain the user id');
  return p;
}

/** Random password that satisfies the policy (initial admin, admin resets). */
export function generatePassword() {
  const base = randomBytes(12).toString('base64url').replace(/[-_]/g, 'x');
  return `${base}A7a`;
}
