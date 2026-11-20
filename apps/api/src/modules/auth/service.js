// Authentication and session rules (PRD 4.1, TASKS P0-08).
// Failures that must be remembered (failed-login counter, lockout, refresh-token reuse) are
// RETURNED as { fail } so the caller commits the transaction before answering with the error.
import { BRANCHES, inKarachi } from '@dcl/shared';
import { Errors } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import { userBranches, userPermissions, userRoles } from '../rbac/repo.js';
import * as repo from './repo.js';
import { hashPassword, passwordProblems, verifyPassword } from './password.js';
import {
  REFRESH_TTL_SEC,
  newFamilyId,
  newRefreshToken,
  sha256,
  signAccessToken,
} from './tokens.js';

/**
 * @typedef {import('../../lib/oracle/db.js').Tx} Tx
 * @typedef {import('../settings/service.js').SettingsReader} SettingsReader
 * @typedef {{ tx: Tx, settings: SettingsReader, clock: { now: () => Date }, jwtSecret: string, audit: import('../audit/service.js').AuditCtx }} AuthDeps
 * @typedef {{ accessToken: string, refreshToken: string, session: object }} Issued
 */

const GENERIC_FAIL = 'Wrong user id or password';
// Hash of a random string, used to spend the same time when the user does not exist.
let dummyHash = null;
async function spendHashTime(plain) {
  dummyHash ??= await hashPassword('dummy-password-for-timing-1A');
  await verifyPassword(dummyHash, plain);
}

const addMinutes = (d, m) => new Date(d.getTime() + m * 60_000);
const addSeconds = (d, s) => new Date(d.getTime() + s * 1000);

function hhmm(d) {
  const k = inKarachi(d);
  return `${String(k.getHours()).padStart(2, '0')}:${String(k.getMinutes()).padStart(2, '0')}`;
}

/** Optional legacy login window (SEC_USERNAME rules): ALLOWED_FROM..ALLOWED_TO, HH:MI, Karachi. */
export function insideLoginWindow(user, now) {
  if (!user.ALLOWED_FROM || !user.ALLOWED_TO) return true;
  const t = hhmm(now);
  return user.ALLOWED_FROM <= user.ALLOWED_TO
    ? t >= user.ALLOWED_FROM && t <= user.ALLOWED_TO
    : t >= user.ALLOWED_FROM || t <= user.ALLOWED_TO; // window across midnight
}

/** Password must be changed: flagged, never set, or older than PWD_LIFE_DAYS. */
async function mustChangePassword(user, settings, now) {
  if (user.MUST_CHANGE_PWD === 'Y' || !user.PWD_CHANGED_ON) return true;
  const life = await settings.num(0, 'PWD_LIFE_DAYS');
  if (!life) return false;
  return now.getTime() - new Date(user.PWD_CHANGED_ON).getTime() > life * 86_400_000;
}

async function issue(deps, user, { brnch, fiscalYear, familyId, ip, userAgent }) {
  const now = deps.clock.now();
  const mcp = await mustChangePassword(user, deps.settings, now);
  const refreshToken = newRefreshToken();
  await repo.insertRefreshToken(deps.tx, {
    userId: user.USER_ID,
    hash: sha256(refreshToken),
    familyId,
    brnch,
    fiscalYear,
    expiresOn: addSeconds(now, REFRESH_TTL_SEC),
    ip,
    userAgent,
    now,
  });
  const accessToken = await signAccessToken(
    { userId: user.USER_ID, usrid: user.USRID, brnch, fiscalYear, mustChangePassword: mcp },
    deps.jwtSecret,
    now,
  );
  return { accessToken, refreshToken, mustChangePassword: mcp };
}

/**
 * POST /auth/login
 * @param {AuthDeps} deps
 * @param {{ usrid: string, password: string, brnch: number, fiscalYear: number, ip?: string, userAgent?: string }} input
 * @returns {Promise<{ fail: import('../../lib/errors.js').AppError } | (Issued & { userId: number })>}
 */
export async function login(deps, input) {
  const { tx, settings, clock } = deps;
  const now = clock.now();
  const user = await repo.findUserByUsrid(tx, input.usrid);
  const auditFail = (key, reason) =>
    recordAudit(
      tx,
      { ...deps.audit, usrid: input.usrid },
      {
        entity: 'APP_USER',
        key,
        action: 'LOGIN_FAILED',
        reason,
        brnch: input.brnch,
      },
    );

  if (!user) {
    await spendHashTime(input.password);
    await auditFail(input.usrid, 'unknown user');
    return { fail: Errors.unauthenticated(GENERIC_FAIL) };
  }
  if (user.STATUS === 'DISABLED') {
    await auditFail(user.USER_ID, 'disabled');
    return { fail: Errors.unauthenticated('This account is disabled. Contact the administrator.') };
  }
  if (user.LOCKED_UNTIL && new Date(user.LOCKED_UNTIL) > now) {
    await auditFail(user.USER_ID, 'locked');
    return {
      fail: Errors.locked(
        `Account locked until ${hhmm(user.LOCKED_UNTIL)} after too many failed logins.`,
      ),
    };
  }
  if (user.STATUS === 'LOCKED') {
    await auditFail(user.USER_ID, 'locked by administrator');
    return { fail: Errors.locked('Account locked by the administrator.') };
  }

  const ok = await verifyPassword(user.PASSWORD_HASH, input.password);
  if (!ok) {
    const maxFails = (await settings.num(0, 'LOGIN_MAX_FAILS')) ?? 5;
    const lockMin = (await settings.num(0, 'LOGIN_LOCK_MIN')) ?? 15;
    const fails = Number(user.FAILED_COUNT) + 1;
    const lockedUntil = fails >= maxFails ? addMinutes(now, lockMin) : null;
    await repo.recordFailedLogin(tx, user.USER_ID, lockedUntil);
    await auditFail(
      user.USER_ID,
      lockedUntil ? `wrong password; locked ${lockMin} min` : 'wrong password',
    );
    if (lockedUntil) {
      return {
        fail: Errors.locked(`Too many failed logins. Account locked for ${lockMin} minutes.`),
      };
    }
    return { fail: Errors.unauthenticated(GENERIC_FAIL) };
  }

  if (!insideLoginWindow(user, now)) {
    await auditFail(user.USER_ID, 'outside login window');
    return {
      fail: Errors.forbidden(
        `Login allowed only between ${user.ALLOWED_FROM} and ${user.ALLOWED_TO}.`,
      ),
    };
  }
  const branches = await userBranches(tx, user.USER_ID);
  if (!branches.some((b) => b.brnch === input.brnch)) {
    await auditFail(user.USER_ID, `branch ${input.brnch} not allowed`);
    return { fail: Errors.branchForbidden(input.brnch) };
  }
  if (!(await repo.fiscalYearExists(tx, input.brnch, input.fiscalYear))) {
    return {
      fail: Errors.validation(`Fiscal year ${input.fiscalYear} does not exist for this branch`),
    };
  }

  await repo.recordSuccessfulLogin(tx, user.USER_ID, now);
  const issued = await issue(deps, user, {
    brnch: input.brnch,
    fiscalYear: input.fiscalYear,
    familyId: newFamilyId(),
    ip: input.ip,
    userAgent: input.userAgent,
  });
  await recordAudit(
    tx,
    { ...deps.audit, userId: user.USER_ID, usrid: user.USRID, brnch: input.brnch },
    {
      entity: 'APP_USER',
      key: user.USER_ID,
      action: 'LOGIN',
      newValues: { brnch: input.brnch, fiscalYear: input.fiscalYear },
    },
  );
  return { ...issued, userId: user.USER_ID };
}

/**
 * POST /auth/refresh — rotate; reuse of a revoked token revokes the whole family.
 * @param {AuthDeps} deps
 */
export async function refresh(deps, { refreshToken, ip, userAgent }) {
  const { tx, clock } = deps;
  const now = clock.now();
  if (!refreshToken) return { fail: Errors.unauthenticated() };
  const row = await repo.findRefreshToken(tx, sha256(refreshToken));
  if (!row) return { fail: Errors.unauthenticated() };
  if (row.REVOKED_ON) {
    await repo.revokeFamily(tx, row.FAMILY_ID, now);
    await recordAudit(
      tx,
      { ...deps.audit, userId: row.USER_ID },
      {
        entity: 'APP_REFRESH_TOKEN',
        key: row.FAMILY_ID,
        action: 'TOKEN_REUSE',
        reason: 'revoked refresh token presented again; session family revoked',
      },
    );
    return { fail: Errors.unauthenticated('Your session ended. Please sign in again.') };
  }
  if (new Date(row.EXPIRES_ON) <= now) return { fail: Errors.unauthenticated('Session expired') };
  const user = await repo.findUserById(tx, row.USER_ID);
  if (
    !user ||
    user.STATUS !== 'ACTIVE' ||
    (user.LOCKED_UNTIL && new Date(user.LOCKED_UNTIL) > now)
  ) {
    await repo.revokeFamily(tx, row.FAMILY_ID, now);
    return { fail: Errors.unauthenticated('Account not active') };
  }
  await repo.revokeRefreshToken(tx, row.TOKEN_ID, now);
  const issued = await issue(deps, user, {
    brnch: row.BRNCH,
    fiscalYear: row.FISCAL_YEAR,
    familyId: row.FAMILY_ID,
    ip,
    userAgent,
  });
  return { ...issued, userId: user.USER_ID };
}

/** POST /auth/logout */
export async function logout(deps, { refreshToken, session }) {
  const now = deps.clock.now();
  if (refreshToken) {
    const row = await repo.findRefreshToken(deps.tx, sha256(refreshToken));
    if (row) await repo.revokeFamily(deps.tx, row.FAMILY_ID, now);
  }
  if (session) {
    await recordAudit(deps.tx, deps.audit, {
      entity: 'APP_USER',
      key: session.userId,
      action: 'LOGOUT',
    });
  }
}

/**
 * POST /auth/change-password
 * @param {AuthDeps} deps
 */
export async function changePassword(deps, { session, currentPassword, newPassword }) {
  const { tx, settings, clock } = deps;
  const now = clock.now();
  const user = await repo.findUserById(tx, session.userId, { forUpdate: true });
  if (!user) throw Errors.unauthenticated();
  if (!(await verifyPassword(user.PASSWORD_HASH, currentPassword))) {
    throw Errors.validation('Current password is wrong', [
      { path: 'currentPassword', message: 'Wrong password' },
    ]);
  }
  const minLength = (await settings.num(0, 'PWD_MIN_LENGTH')) ?? 10;
  const problems = passwordProblems(newPassword, { minLength, usrid: user.USRID });
  if (problems.length) {
    throw Errors.validation(`New password must have ${problems.join(', ')}`, [
      { path: 'newPassword', message: `Must have ${problems.join(', ')}` },
    ]);
  }
  const keep = (await settings.num(0, 'PWD_HISTORY')) ?? 5;
  const previous = [
    user.PASSWORD_HASH,
    ...(await repo.recentPasswordHashes(tx, user.USER_ID, keep)),
  ];
  for (const h of previous.slice(0, keep)) {
    if (await verifyPassword(h, newPassword)) {
      throw Errors.validation(`New password must differ from your last ${keep} passwords`, [
        { path: 'newPassword', message: 'Used recently' },
      ]);
    }
  }
  if (user.PASSWORD_HASH) await repo.addPasswordHistory(tx, user.USER_ID, user.PASSWORD_HASH, now);
  await repo.setPassword(tx, user.USER_ID, await hashPassword(newPassword), {
    mustChange: false,
    now,
    by: user.USRID,
  });
  // end every other session of this user; keep the current family alive via a fresh token
  await repo.revokeAllForUser(tx, user.USER_ID, now);
  await recordAudit(tx, deps.audit, {
    entity: 'APP_USER',
    key: user.USER_ID,
    action: 'PASSWORD_CHANGE',
  });
  const fresh = await repo.findUserById(tx, user.USER_ID);
  return issue(deps, fresh, {
    brnch: session.brnch,
    fiscalYear: session.fiscalYear,
    familyId: newFamilyId(),
  });
}

/** POST /auth/switch-branch */
export async function switchBranch(
  deps,
  { session, brnch, fiscalYear, refreshToken, ip, userAgent },
) {
  const { tx, clock } = deps;
  const branches = await userBranches(tx, session.userId);
  if (!branches.some((b) => b.brnch === brnch)) throw Errors.branchForbidden(brnch);
  if (!(await repo.fiscalYearExists(tx, brnch, fiscalYear))) {
    throw Errors.validation(`Fiscal year ${fiscalYear} does not exist for this branch`);
  }
  let familyId = newFamilyId();
  if (refreshToken) {
    const row = await repo.findRefreshToken(tx, sha256(refreshToken));
    if (row && !row.REVOKED_ON) {
      await repo.revokeRefreshToken(tx, row.TOKEN_ID, clock.now());
      familyId = row.FAMILY_ID;
    }
  }
  const user = await repo.findUserById(tx, session.userId);
  await recordAudit(
    tx,
    { ...deps.audit, brnch },
    {
      entity: 'APP_USER',
      key: session.userId,
      action: 'SWITCH_BRANCH',
      oldValues: { brnch: session.brnch, fiscalYear: session.fiscalYear },
      newValues: { brnch, fiscalYear },
    },
  );
  return issue(deps, user, { brnch, fiscalYear, familyId, ip, userAgent });
}

/**
 * GET /auth/me — everything the web shell needs.
 * @param {Tx} tx
 */
export async function me(tx, session) {
  const user = await repo.findUserById(tx, session.userId);
  if (!user) throw Errors.unauthenticated();
  const [branches, roles, permissions, years] = await Promise.all([
    userBranches(tx, user.USER_ID),
    userRoles(tx, user.USER_ID),
    userPermissions(tx, user.USER_ID, session.brnch),
    repo.fiscalYears(tx),
  ]);
  return {
    user: {
      userId: user.USER_ID,
      usrid: user.USRID,
      fullName: user.FULL_NAME,
      designation: user.DESIGNATION,
      email: user.EMAIL,
    },
    branch: session.brnch,
    fiscalYear: session.fiscalYear,
    mustChangePassword: session.mustChangePassword,
    branches: branches.map((b) => ({
      ...b,
      name: BRANCHES.find((x) => x.brnch === b.brnch)?.name ?? `Branch ${b.brnch}`,
      roles: roles.filter((r) => r.brnch === b.brnch).map((r) => r.roleCode),
      fiscalYears: years
        .filter((y) => y.brnch === b.brnch)
        .map((y) => ({ year: y.year, label: y.label, closed: y.closed })),
    })),
    permissions: [...permissions].sort(),
  };
}
