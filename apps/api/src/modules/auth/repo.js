// SQL for users, password history, refresh tokens and fiscal years. No business rules here.

/** @typedef {import('../../lib/oracle/db.js').Tx} Tx */

const USER_COLS = `USER_ID, USRID, FULL_NAME, DESIGNATION, EMAIL, MOBILE, PASSWORD_HASH, MUST_CHANGE_PWD,
  PWD_CHANGED_ON, FAILED_COUNT, LOCKED_UNTIL, ALLOWED_FROM, ALLOWED_TO, STATUS, HOME_BRNCH, ROW_VER`;

/** @param {Tx} tx */
export function findUserByUsrid(tx, usrid) {
  return tx.one(`SELECT ${USER_COLS} FROM APP_USER WHERE UPPER(USRID) = UPPER(:u)`, { u: usrid });
}

/** @param {Tx} tx */
export function findUserById(tx, userId, { forUpdate = false } = {}) {
  return tx.one(
    `SELECT ${USER_COLS} FROM APP_USER WHERE USER_ID = :id${forUpdate ? ' FOR UPDATE' : ''}`,
    { id: userId },
  );
}

/** @param {Tx} tx */
export function recordFailedLogin(tx, userId, lockedUntil) {
  return tx.exec(
    `UPDATE APP_USER SET FAILED_COUNT = FAILED_COUNT + 1, LOCKED_UNTIL = :lu WHERE USER_ID = :id`,
    { id: userId, lu: lockedUntil },
  );
}

/** @param {Tx} tx */
export function recordSuccessfulLogin(tx, userId, now) {
  return tx.exec(
    `UPDATE APP_USER SET FAILED_COUNT = 0, LOCKED_UNTIL = NULL, LAST_LOGIN_ON = :now WHERE USER_ID = :id`,
    { id: userId, now },
  );
}

/** @param {Tx} tx */
export async function setPassword(tx, userId, hash, { mustChange, now, by }) {
  await tx.exec(
    `UPDATE APP_USER SET PASSWORD_HASH = :h, PWD_CHANGED_ON = :now, MUST_CHANGE_PWD = :m,
            FAILED_COUNT = 0, LOCKED_UNTIL = NULL, UPDATED_BY = :upd, UPDATED_ON = :now, ROW_VER = ROW_VER + 1
      WHERE USER_ID = :id`,
    { id: userId, h: hash, now, m: mustChange ? 'Y' : 'N', upd: by },
  );
}

/** @param {Tx} tx */
export function addPasswordHistory(tx, userId, hash, now) {
  return tx.exec(
    'INSERT INTO APP_PASSWORD_HISTORY (USER_ID, PWD_HASH, CHANGED_ON) VALUES (:id, :h, :now)',
    { id: userId, h: hash, now },
  );
}

/** Last `n` previous hashes, newest first. @param {Tx} tx */
export async function recentPasswordHashes(tx, userId, n) {
  const rows = await tx.many(
    `SELECT PWD_HASH FROM (
       SELECT PWD_HASH FROM APP_PASSWORD_HISTORY WHERE USER_ID = :id ORDER BY CHANGED_ON DESC
     ) WHERE ROWNUM <= :n`,
    { id: userId, n },
  );
  return rows.map((r) => r.PWD_HASH);
}

/** @param {Tx} tx */
export async function insertRefreshToken(tx, row) {
  const id = await tx.nextId('SEQ_APP_REFRESH_TOKEN');
  await tx.exec(
    `INSERT INTO APP_REFRESH_TOKEN (TOKEN_ID, USER_ID, TOKEN_HASH, FAMILY_ID, BRNCH, FISCAL_YEAR, EXPIRES_ON, IP, USER_AGENT, CREATED_ON)
     VALUES (:id, :userId, :hash, :family, :brnch, :fy, :exp, :ip, :ua, :now)`,
    {
      id,
      userId: row.userId,
      hash: row.hash,
      family: row.familyId,
      brnch: row.brnch,
      fy: row.fiscalYear,
      exp: row.expiresOn,
      ip: row.ip ?? null,
      ua: row.userAgent ? String(row.userAgent).slice(0, 400) : null,
      now: row.now,
    },
  );
  return id;
}

/** @param {Tx} tx */
export function findRefreshToken(tx, hash) {
  return tx.one(
    `SELECT TOKEN_ID, USER_ID, FAMILY_ID, BRNCH, FISCAL_YEAR, EXPIRES_ON, REVOKED_ON
       FROM APP_REFRESH_TOKEN WHERE TOKEN_HASH = :h FOR UPDATE`,
    { h: hash },
  );
}

/** @param {Tx} tx */
export function revokeRefreshToken(tx, tokenId, now) {
  return tx.exec(
    'UPDATE APP_REFRESH_TOKEN SET REVOKED_ON = :now WHERE TOKEN_ID = :id AND REVOKED_ON IS NULL',
    { id: tokenId, now },
  );
}

/** @param {Tx} tx */
export function revokeFamily(tx, familyId, now) {
  return tx.exec(
    'UPDATE APP_REFRESH_TOKEN SET REVOKED_ON = :now WHERE FAMILY_ID = :f AND REVOKED_ON IS NULL',
    { f: familyId, now },
  );
}

/** @param {Tx} tx */
export function revokeAllForUser(tx, userId, now) {
  return tx.exec(
    'UPDATE APP_REFRESH_TOKEN SET REVOKED_ON = :now WHERE USER_ID = :u AND REVOKED_ON IS NULL',
    { u: userId, now },
  );
}

/** Fiscal years per branch from SALES_YEAR (newest first). @param {Tx} tx */
export async function fiscalYears(tx) {
  const rows = await tx.many(
    `SELECT BRNCH, YEAR, YSTART, YEND, NVL(CLOSE, 0) AS CLOSED, DESCR
       FROM SALES_YEAR WHERE BRNCH IN (1, 2) ORDER BY BRNCH, YEAR DESC`,
  );
  return rows.map((r) => ({
    brnch: r.BRNCH,
    year: r.YEAR,
    start: r.YSTART,
    end: r.YEND,
    closed: Number(r.CLOSED) === 1,
    label: (r.DESCR ?? `${r.YEAR - 1} - ${r.YEAR}`).replace(/\s*-\s*/, ' - '),
  }));
}

/** @param {Tx} tx */
export async function fiscalYearExists(tx, brnch, year) {
  const r = await tx.one('SELECT COUNT(*) AS N FROM SALES_YEAR WHERE BRNCH = :b AND YEAR = :y', {
    b: brnch,
    y: year,
  });
  return r.N > 0;
}
