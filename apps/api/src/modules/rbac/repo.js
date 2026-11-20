// Users' branches, roles and permissions (PERMISSIONS model: user → roles per branch → permissions).

/** @param {import('../../lib/oracle/db.js').Tx} tx */
export async function userBranches(tx, userId) {
  const rows = await tx.many(
    'SELECT BRNCH, IS_DEFAULT FROM APP_USER_BRANCH WHERE USER_ID = :u ORDER BY BRNCH',
    { u: userId },
  );
  return rows.map((r) => ({ brnch: r.BRNCH, isDefault: r.IS_DEFAULT === 'Y' }));
}

/** Roles per branch. */
export async function userRoles(tx, userId) {
  const rows = await tx.many(
    `SELECT ur.BRNCH, ur.ROLE_CODE FROM APP_USER_ROLE ur
       JOIN APP_ROLE r ON r.ROLE_CODE = ur.ROLE_CODE AND r.ACTIVE = 'Y'
      WHERE ur.USER_ID = :u ORDER BY ur.BRNCH, ur.ROLE_CODE`,
    { u: userId },
  );
  return rows.map((r) => ({ brnch: r.BRNCH, roleCode: r.ROLE_CODE }));
}

/**
 * Permission keys a user holds in one branch.
 * @returns {Promise<Set<string>>}
 */
export async function userPermissions(tx, userId, brnch) {
  const rows = await tx.many(
    `SELECT DISTINCT rp.PERM_KEY
       FROM APP_USER_ROLE ur
       JOIN APP_ROLE r ON r.ROLE_CODE = ur.ROLE_CODE AND r.ACTIVE = 'Y'
       JOIN APP_ROLE_PERMISSION rp ON rp.ROLE_CODE = ur.ROLE_CODE
      WHERE ur.USER_ID = :u AND ur.BRNCH = :b`,
    { u: userId, b: brnch },
  );
  return new Set(rows.map((r) => r.PERM_KEY));
}

/** Users holding a role in a branch (approval routing, notifications). */
export async function usersWithRole(tx, roleCode, brnch) {
  const rows = await tx.many(
    `SELECT u.USER_ID, u.USRID, u.FULL_NAME, u.EMAIL FROM APP_USER_ROLE ur
       JOIN APP_USER u ON u.USER_ID = ur.USER_ID AND u.STATUS = 'ACTIVE'
      WHERE ur.ROLE_CODE = :r AND ur.BRNCH = :b`,
    { r: roleCode, b: brnch },
  );
  return rows.map((r) => ({
    userId: r.USER_ID,
    usrid: r.USRID,
    fullName: r.FULL_NAME,
    email: r.EMAIL,
  }));
}
