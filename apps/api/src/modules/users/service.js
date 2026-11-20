// User administration rules (PRD 4.19, PERMISSIONS §2 footnote 1, P-7).
import { RESTRICTED_ROLES } from '@dcl/shared';
import { Errors } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import { revokeAllForUser, setPassword } from '../auth/repo.js';
import { generatePassword, hashPassword } from '../auth/password.js';
import * as repo from './repo.js';

/**
 * @typedef {import('../../lib/oracle/db.js').Tx} Tx
 * @typedef {{ userId: number, usrid: string, scope: number[], isSysAdmin: boolean, audit: object, now: Date }} Actor
 *   scope = branches where the actor holds admin.users
 */

async function activeRoles(tx) {
  const rows = await tx.many(`SELECT ROLE_CODE FROM APP_ROLE WHERE ACTIVE = 'Y'`);
  return new Set(rows.map((r) => r.ROLE_CODE));
}

/** Validate a requested access list against the actor's rights. */
async function checkAccess(tx, actor, access) {
  const roles = await activeRoles(tx);
  const seen = new Set();
  for (const a of access) {
    if (seen.has(a.brnch)) throw Errors.validation(`Branch ${a.brnch} listed twice`);
    seen.add(a.brnch);
    if (!actor.isSysAdmin && !actor.scope.includes(a.brnch)) throw Errors.branchForbidden(a.brnch);
    for (const r of a.roles) {
      if (!roles.has(r)) throw Errors.validation(`Unknown or inactive role ${r}`);
      if (RESTRICTED_ROLES.includes(r) && !actor.isSysAdmin) {
        throw Errors.forbidden(`Only a system administrator can grant ${r}`);
      }
    }
  }
  if (access.filter((a) => a.isDefault).length > 1)
    throw Errors.validation('Only one default branch');
}

/** The target must share a branch with the actor's scope (otherwise it does not exist for them). */
async function loadVisible(tx, actor, userId, opts) {
  const user = await repo.getUser(tx, userId, opts);
  if (!user) throw Errors.notFound('User');
  const access = await repo.getAccess(tx, userId);
  if (!actor.isSysAdmin && !access.some((a) => actor.scope.includes(a.brnch)))
    throw Errors.notFound('User');
  return { user, access };
}

/** @param {Tx} tx @param {Actor} actor */
export async function getUserDetail(tx, actor, userId) {
  const { user, access } = await loadVisible(tx, actor, userId);
  return { ...user, access };
}

/** @param {Tx} tx @param {Actor} actor */
export async function createUser(tx, actor, input) {
  if (await repo.usridExists(tx, input.usrid))
    throw Errors.duplicate(`User id ${input.usrid} already exists`);
  await checkAccess(tx, actor, input.access);
  if (!input.access.some((a) => a.brnch === input.homeBrnch)) {
    throw Errors.validation('Home branch must be one of the allowed branches');
  }
  const password = generatePassword();
  const userId = await repo.insertUser(tx, input, {
    hash: await hashPassword(password),
    by: actor.usrid,
    now: actor.now,
  });
  await repo.replaceAccess(tx, userId, input.access, { by: actor.usrid });
  await recordAudit(tx, actor.audit, {
    entity: 'APP_USER',
    key: userId,
    action: 'CREATE',
    newValues: { ...input },
  });
  return { userId, temporaryPassword: password };
}

/** @param {Tx} tx @param {Actor} actor */
export async function updateUser(tx, actor, userId, rowVer, input) {
  const { user } = await loadVisible(tx, actor, userId, { forUpdate: true });
  const n = await repo.updateUser(tx, userId, rowVer, input, { by: actor.usrid, now: actor.now });
  if (n === 0) throw Errors.versionConflict();
  const { rowVer: _v, ...old } = user;
  await recordAudit(tx, actor.audit, {
    entity: 'APP_USER',
    key: userId,
    action: 'UPDATE',
    oldValues: old,
    newValues: input,
  });
}

/** @param {Tx} tx @param {Actor} actor */
export async function setUserStatus(tx, actor, userId, status, reason) {
  if (userId === actor.userId) throw Errors.forbidden('You cannot lock or unlock your own account');
  const { user } = await loadVisible(tx, actor, userId, { forUpdate: true });
  await repo.setStatus(tx, userId, status, { by: actor.usrid, now: actor.now });
  if (status !== 'ACTIVE') await revokeAllForUser(tx, userId, actor.now);
  await recordAudit(tx, actor.audit, {
    entity: 'APP_USER',
    key: userId,
    action: status === 'ACTIVE' ? 'UNLOCK' : 'LOCK',
    reason,
    oldValues: { status: user.status },
    newValues: { status },
  });
}

/** @param {Tx} tx @param {Actor} actor */
export async function resetPassword(tx, actor, userId) {
  await loadVisible(tx, actor, userId, { forUpdate: true });
  const password = generatePassword();
  await setPassword(tx, userId, await hashPassword(password), {
    mustChange: true,
    now: actor.now,
    by: actor.usrid,
  });
  await revokeAllForUser(tx, userId, actor.now);
  await recordAudit(tx, actor.audit, { entity: 'APP_USER', key: userId, action: 'RESET_PASSWORD' });
  return { temporaryPassword: password };
}

/**
 * Replace branch access. A branch admin only changes entries of its own branches; other branches
 * the user has stay as they are.
 * @param {Tx} tx @param {Actor} actor
 */
export async function setUserAccess(tx, actor, userId, access) {
  const { access: before } = await loadVisible(tx, actor, userId, { forUpdate: true });
  await checkAccess(tx, actor, access);
  const kept = actor.isSysAdmin ? [] : before.filter((a) => !actor.scope.includes(a.brnch));
  if (!actor.isSysAdmin) {
    // a branch admin cannot remove SYS_ADMIN from someone in its branch either
    for (const a of before.filter((x) => actor.scope.includes(x.brnch))) {
      const next = access.find((x) => x.brnch === a.brnch);
      for (const r of RESTRICTED_ROLES) {
        if (a.roles.includes(r) && !next?.roles.includes(r)) {
          throw Errors.forbidden(`Only a system administrator can remove ${r}`);
        }
      }
    }
  }
  const merged = [...kept, ...access];
  if (merged.length === 0) throw Errors.validation('A user needs at least one branch');
  if (merged.filter((a) => a.isDefault).length > 1)
    throw Errors.validation('Only one default branch');
  await repo.replaceAccess(tx, userId, merged, { by: actor.usrid });
  await revokeAllForUser(tx, userId, actor.now); // new rights take effect at next sign-in/refresh
  await recordAudit(tx, actor.audit, {
    entity: 'APP_USER_ROLE',
    key: userId,
    action: 'UPDATE',
    oldValues: before,
    newValues: merged,
  });
  return merged;
}
