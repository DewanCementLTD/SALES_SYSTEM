// Seed data (pnpm db:seed). Every function only INSERTS what is missing, so it can run any time.
// Existing rows (e.g. a setting changed by an admin) are never overwritten.
import { ALL_PERMISSIONS, ROLES, SETTINGS, fiscalYearOf } from '@dcl/shared';
import { generatePassword, hashPassword } from '../modules/auth/password.js';
import { seedDocSequence } from '../modules/numbering/seed.js';

/** @typedef {import('../lib/oracle/db.js').Tx} Tx */

/** @param {Tx} tx */
export async function seedPermissions(tx) {
  let created = 0;
  for (const p of ALL_PERMISSIONS) {
    created += await tx.exec(
      `INSERT INTO APP_PERMISSION (PERM_KEY, MODULE, ACTION, IS_SENSITIVE)
       SELECT :k, :m, :a, :s FROM DUAL
        WHERE NOT EXISTS (SELECT 1 FROM APP_PERMISSION WHERE PERM_KEY = :k)`,
      { k: p.key, m: p.module, a: p.action, s: p.sensitive ? 'Y' : 'N' },
    );
  }
  return created;
}

/** @param {Tx} tx */
export async function seedRoles(tx) {
  let roles = 0;
  let grants = 0;
  for (const r of ROLES) {
    roles += await tx.exec(
      `INSERT INTO APP_ROLE (ROLE_CODE, ROLE_NAME, DESCR, IS_SYSTEM, ACTIVE)
       SELECT :c, :n, :d, 'Y', 'Y' FROM DUAL
        WHERE NOT EXISTS (SELECT 1 FROM APP_ROLE WHERE ROLE_CODE = :c)`,
      { c: r.code, n: r.name, d: r.descr },
    );
    for (const key of r.permissions) {
      grants += await tx.exec(
        `INSERT INTO APP_ROLE_PERMISSION (ROLE_CODE, PERM_KEY)
         SELECT :c, :k FROM DUAL
          WHERE NOT EXISTS (SELECT 1 FROM APP_ROLE_PERMISSION WHERE ROLE_CODE = :c AND PERM_KEY = :k)`,
        { c: r.code, k: key },
      );
    }
  }
  return { roles, grants };
}

/** @param {Tx} tx */
export async function seedSettings(tx) {
  let created = 0;
  for (const s of Object.values(SETTINGS)) {
    const descr = `${s.descr} (${s.rule}${s.openQ ? `, OPEN-${s.openQ}` : ''})`.slice(0, 400);
    created += await tx.exec(
      `INSERT INTO APP_SETTING (BRNCH, SETTING_KEY, SETTING_VALUE, VALUE_TYPE, DESCR, UPDATED_BY)
       SELECT 0, :k, :v, :t, :d, 'seed' FROM DUAL
        WHERE NOT EXISTS (SELECT 1 FROM APP_SETTING WHERE BRNCH = 0 AND SETTING_KEY = :k)`,
      { k: s.key, v: s.def === '' ? null : s.def, t: s.type, d: descr },
    );
  }
  return created;
}

/**
 * Default approval rules (BR-APR-04). Approver roles marked "default" are not stated in the docs:
 * they follow the PERMISSIONS §3 holder of the matching approve right and are editable in Admin.
 */
export const DEFAULT_APPROVAL_RULES = [
  {
    docType: 'CUSTOMER_APPROVE',
    name: 'New customer / customer change',
    role: 'CUSTOMER_APPROVER',
  },
  { docType: 'CREDIT_LIMIT', name: 'Credit limit document', role: 'FINANCE_MANAGER' },
  {
    docType: 'RATE_CHANGE',
    name: 'Trade price / rate sheet / tax rate change',
    role: 'FINANCE_MANAGER',
  },
  { docType: 'OC_PRICE_OVERRIDE', name: 'OC price below master (OPEN-Q8)', role: 'SALES_MANAGER' },
  {
    docType: 'OC_BALANCE_OVERRIDE',
    name: 'OC confirmation with insufficient balance',
    role: 'CFO',
  },
  { docType: 'PERMIT_CFO', name: 'Permit sent to CFO', role: 'CFO' },
  {
    docType: 'PERMIT_BALANCE_OVERRIDE',
    name: 'Permit issue with insufficient balance',
    role: 'CFO',
  },
  { docType: 'DO_CANCEL', name: 'DO cancel after partial dispatch', role: 'FINANCE_MANAGER' },
  // BR-DO-06: approver is a default to confirm (same as DO_CANCEL)
  { docType: 'DO_ADJUST', name: 'DO quantity adjustment advice', role: 'FINANCE_MANAGER' },
  { docType: 'WEIGHT_OVERRIDE', name: 'Weight variance outside tolerance', role: 'PLANT_MANAGER' },
  { docType: 'DC_CANCEL', name: 'DC cancel after invoice (pre-FBR)', role: 'FINANCE_MANAGER' },
  { docType: 'NOTE_POST', name: 'Credit / debit note posting', role: 'FINANCE_MANAGER' },
  { docType: 'EXIT_WITHOUT_FBR', name: 'Exit while FBR pending (OPEN-Q3)', role: 'PLANT_MANAGER' },
];

/** @param {Tx} tx */
export async function seedApprovalRules(tx) {
  let created = 0;
  for (const r of DEFAULT_APPROVAL_RULES) {
    const exists = await tx.one('SELECT COUNT(*) AS N FROM APPROVAL_RULE WHERE DOC_TYPE = :d', {
      d: r.docType,
    });
    if (exists.N > 0) continue;
    const id = await tx.nextId('SEQ_APPROVAL_RULE');
    await tx.exec(
      `INSERT INTO APPROVAL_RULE (RULE_ID, BRNCH, DOC_TYPE, RULE_NAME, LEVELS, LEVEL1_ROLE, SAME_USER_ALLOWED, PRIORITY, ACTIVE)
       VALUES (:id, 0, :d, :n, 1, :r, 'N', 100, 'Y')`,
      { id, d: r.docType, n: r.name, r: r.role },
    );
    created += 1;
  }
  return created;
}

/**
 * First system administrator, only when APP_USER is empty. Returns the one-time password.
 * @param {Tx} tx
 */
export async function seedAdminUser(tx, { usrid = 'admin', password } = {}) {
  const n = await tx.one('SELECT COUNT(*) AS N FROM APP_USER');
  if (n.N > 0) return null;
  const plain = password ?? generatePassword();
  const id = await tx.nextId('SEQ_APP_USER');
  await tx.exec(
    `INSERT INTO APP_USER (USER_ID, USRID, FULL_NAME, PASSWORD_HASH, MUST_CHANGE_PWD, STATUS, HOME_BRNCH, CREATED_BY)
     VALUES (:id, :u, 'System Administrator', :h, 'Y', 'ACTIVE', 1, 'seed')`,
    { id, u: usrid, h: await hashPassword(plain) },
  );
  for (const b of [1, 2]) {
    await tx.exec(`INSERT INTO APP_USER_BRANCH (USER_ID, BRNCH, IS_DEFAULT) VALUES (:id, :b, :d)`, {
      id,
      b,
      d: b === 1 ? 'Y' : 'N',
    });
    await tx.exec(
      `INSERT INTO APP_USER_ROLE (USER_ID, BRNCH, ROLE_CODE, GRANTED_BY) VALUES (:id, :b, 'SYS_ADMIN', 'seed')`,
      { id, b },
    );
  }
  return { usrid, password: plain, userId: id };
}

/**
 * Run all seeds in one transaction.
 * @param {Tx} tx
 * @param {{ clock: { now: () => Date }, adminPassword?: string }} opts
 */
export async function seedAll(tx, { clock, adminPassword }) {
  const year = fiscalYearOf(clock.now());
  const permissions = await seedPermissions(tx);
  const roles = await seedRoles(tx);
  const settings = await seedSettings(tx);
  const approvalRules = await seedApprovalRules(tx);
  const numbering = await seedDocSequence(tx, year);
  const admin = await seedAdminUser(tx, { password: adminPassword });
  return { year, permissions, roles, settings, approvalRules, numbering, admin };
}
