// SQL for user administration (APP_USER, APP_USER_BRANCH, APP_USER_ROLE).
import { branchFilter } from '../../lib/branch-scope.js';
import { paginate } from '../../lib/oracle/paginate.js';

/** @typedef {import('../../lib/oracle/db.js').Tx} Tx */

const toUser = (r) => ({
  userId: r.USER_ID,
  usrid: r.USRID,
  fullName: r.FULL_NAME,
  designation: r.DESIGNATION,
  email: r.EMAIL,
  mobile: r.MOBILE,
  status: r.STATUS,
  homeBrnch: r.HOME_BRNCH,
  mustChangePassword: r.MUST_CHANGE_PWD === 'Y',
  lockedUntil: r.LOCKED_UNTIL ?? null,
  allowedFrom: r.ALLOWED_FROM ?? null,
  allowedTo: r.ALLOWED_TO ?? null,
  lastLoginOn: r.LAST_LOGIN_ON ?? null,
  rowVer: r.ROW_VER,
});

const COLS = `u.USER_ID, u.USRID, u.FULL_NAME, u.DESIGNATION, u.EMAIL, u.MOBILE, u.STATUS, u.HOME_BRNCH,
  u.MUST_CHANGE_PWD, u.LOCKED_UNTIL, u.ALLOWED_FROM, u.ALLOWED_TO, u.LAST_LOGIN_ON, u.ROW_VER`;

/**
 * Users having at least one of `branches` (branch-scoped admin list, BR-BR-04).
 * @param {Tx} tx
 */
export async function listUsers(tx, { branches, q, status, page, pageSize }) {
  const bf = branchFilter('ub.BRNCH', branches);
  const binds = { ...bf.binds };
  let where = `EXISTS (SELECT 1 FROM APP_USER_BRANCH ub WHERE ub.USER_ID = u.USER_ID AND ${bf.sql})`;
  if (q) {
    where += ` AND (UPPER(u.USRID) LIKE :q OR UPPER(u.FULL_NAME) LIKE :q)`;
    binds.q = `%${q.toUpperCase()}%`;
  }
  if (status) {
    where += ' AND u.STATUS = :st';
    binds.st = status;
  }
  const res = await paginate(tx, {
    sql: `SELECT ${COLS} FROM APP_USER u WHERE ${where} ORDER BY u.USRID, u.USER_ID`,
    binds,
    page,
    pageSize,
  });
  return { ...res, items: res.items.map(toUser) };
}

/** @param {Tx} tx */
export async function getUser(tx, userId, { forUpdate = false } = {}) {
  const r = await tx.one(
    `SELECT ${COLS} FROM APP_USER u WHERE u.USER_ID = :id${forUpdate ? ' FOR UPDATE' : ''}`,
    {
      id: userId,
    },
  );
  return r ? toUser(r) : null;
}

/** @param {Tx} tx */
export async function getAccess(tx, userId) {
  const rows = await tx.many(
    `SELECT ub.BRNCH, ub.IS_DEFAULT, ur.ROLE_CODE
       FROM APP_USER_BRANCH ub
       LEFT JOIN APP_USER_ROLE ur ON ur.USER_ID = ub.USER_ID AND ur.BRNCH = ub.BRNCH
      WHERE ub.USER_ID = :id ORDER BY ub.BRNCH, ur.ROLE_CODE`,
    { id: userId },
  );
  const map = new Map();
  for (const r of rows) {
    const e = map.get(r.BRNCH) ?? { brnch: r.BRNCH, isDefault: r.IS_DEFAULT === 'Y', roles: [] };
    if (r.ROLE_CODE) e.roles.push(r.ROLE_CODE);
    map.set(r.BRNCH, e);
  }
  return [...map.values()];
}

/** @param {Tx} tx */
export async function usridExists(tx, usrid) {
  const r = await tx.one('SELECT COUNT(*) AS N FROM APP_USER WHERE UPPER(USRID) = UPPER(:u)', {
    u: usrid,
  });
  return r.N > 0;
}

/** @param {Tx} tx */
export async function insertUser(tx, u, { hash, by, now }) {
  const id = await tx.nextId('SEQ_APP_USER');
  await tx.exec(
    `INSERT INTO APP_USER (USER_ID, USRID, FULL_NAME, DESIGNATION, EMAIL, MOBILE, PASSWORD_HASH, MUST_CHANGE_PWD,
        STATUS, HOME_BRNCH, ALLOWED_FROM, ALLOWED_TO, CREATED_BY, CREATED_ON)
     VALUES (:id, :usrid, :fn, :des, :em, :mob, :h, 'Y', 'ACTIVE', :hb, :af, :at2, :cb, :now)`,
    {
      id,
      usrid: u.usrid,
      fn: u.fullName,
      des: u.designation ?? null,
      em: u.email ?? null,
      mob: u.mobile ?? null,
      h: hash,
      hb: u.homeBrnch,
      af: u.allowedFrom ?? null,
      at2: u.allowedTo ?? null,
      cb: by,
      now,
    },
  );
  return id;
}

/** Optimistic update; returns rows affected (0 = version conflict). @param {Tx} tx */
export function updateUser(tx, userId, rowVer, u, { by, now }) {
  return tx.exec(
    `UPDATE APP_USER SET FULL_NAME = :fn, DESIGNATION = :des, EMAIL = :em, MOBILE = :mob, HOME_BRNCH = :hb,
            ALLOWED_FROM = :af, ALLOWED_TO = :at2, UPDATED_BY = :ub, UPDATED_ON = :now, ROW_VER = ROW_VER + 1
      WHERE USER_ID = :id AND ROW_VER = :ver`,
    {
      id: userId,
      ver: rowVer,
      fn: u.fullName,
      des: u.designation ?? null,
      em: u.email ?? null,
      mob: u.mobile ?? null,
      hb: u.homeBrnch,
      af: u.allowedFrom ?? null,
      at2: u.allowedTo ?? null,
      ub: by,
      now,
    },
  );
}

/** @param {Tx} tx */
export function setStatus(tx, userId, status, { by, now }) {
  return tx.exec(
    `UPDATE APP_USER SET STATUS = :s, FAILED_COUNT = 0, LOCKED_UNTIL = NULL, UPDATED_BY = :ub, UPDATED_ON = :now,
            ROW_VER = ROW_VER + 1 WHERE USER_ID = :id`,
    { id: userId, s: status, ub: by, now },
  );
}

/**
 * Replace branch access and roles. Role grants are configuration (not business documents), so
 * removed grants are deleted; every change is audited by the service (PERMISSIONS P-7).
 * @param {Tx} tx
 */
export async function replaceAccess(tx, userId, access, { by }) {
  await tx.exec('DELETE FROM APP_USER_ROLE WHERE USER_ID = :id', { id: userId });
  await tx.exec('DELETE FROM APP_USER_BRANCH WHERE USER_ID = :id', { id: userId });
  for (const a of access) {
    await tx.exec(`INSERT INTO APP_USER_BRANCH (USER_ID, BRNCH, IS_DEFAULT) VALUES (:id, :b, :d)`, {
      id: userId,
      b: a.brnch,
      d: a.isDefault ? 'Y' : 'N',
    });
    for (const role of a.roles) {
      await tx.exec(
        `INSERT INTO APP_USER_ROLE (USER_ID, BRNCH, ROLE_CODE, GRANTED_BY) VALUES (:id, :b, :r, :gb)`,
        { id: userId, b: a.brnch, r: role, gb: by },
      );
    }
  }
}

/** Does the actor hold a role in any branch? @param {Tx} tx */
export async function hasRoleAnywhere(tx, userId, roleCode) {
  const r = await tx.one(
    'SELECT COUNT(*) AS N FROM APP_USER_ROLE WHERE USER_ID = :u AND ROLE_CODE = :r',
    {
      u: userId,
      r: roleCode,
    },
  );
  return r.N > 0;
}
