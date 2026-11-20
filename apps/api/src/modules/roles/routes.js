// /api/v1/admin/roles, /api/v1/admin/permissions (API_SPEC §3). Permission changes are audited (P-7).
import { ALL_PERMISSIONS, P, isPermissionKey } from '@dcl/shared';
import { z } from 'zod';
import { Errors } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import { hasRoleAnywhere } from '../users/repo.js';

const zRole = z.object({
  code: z.string(),
  name: z.string(),
  descr: z.string().nullable(),
  isSystem: z.boolean(),
  active: z.boolean(),
  permissions: z.array(z.string()),
  userCount: z.number(),
});

const zRoleBody = z.object({
  name: z.string().trim().min(2).max(100),
  descr: z.string().trim().max(400).nullable().optional(),
  active: z.boolean().default(true),
  permissions: z.array(z.string()).max(500),
});

/** @param {import('../../lib/oracle/db.js').Tx} tx */
async function loadRoles(tx) {
  const roles = await tx.many(
    `SELECT r.ROLE_CODE, r.ROLE_NAME, r.DESCR, r.IS_SYSTEM, r.ACTIVE,
            (SELECT COUNT(DISTINCT ur.USER_ID) FROM APP_USER_ROLE ur WHERE ur.ROLE_CODE = r.ROLE_CODE) AS USERS
       FROM APP_ROLE r ORDER BY r.ROLE_CODE`,
  );
  const grants = await tx.many(
    'SELECT ROLE_CODE, PERM_KEY FROM APP_ROLE_PERMISSION ORDER BY PERM_KEY',
  );
  return roles.map((r) => ({
    code: r.ROLE_CODE,
    name: r.ROLE_NAME,
    descr: r.DESCR,
    isSystem: r.IS_SYSTEM === 'Y',
    active: r.ACTIVE === 'Y',
    permissions: grants.filter((g) => g.ROLE_CODE === r.ROLE_CODE).map((g) => g.PERM_KEY),
    userCount: Number(r.USERS),
  }));
}

/** Replace a role's permission set (configuration rows; audited). */
async function replacePermissions(tx, code, keys) {
  await tx.exec('DELETE FROM APP_ROLE_PERMISSION WHERE ROLE_CODE = :c', { c: code });
  await tx.execMany(
    'INSERT INTO APP_ROLE_PERMISSION (ROLE_CODE, PERM_KEY) VALUES (:c, :k)',
    keys.map((k) => ({ c: code, k })),
  );
}

function checkKeys(keys) {
  const bad = keys.filter((k) => !isPermissionKey(k));
  if (bad.length) throw Errors.validation(`Unknown permissions: ${bad.join(', ')}`);
  return [...new Set(keys)].sort();
}

/** @param {import('fastify').FastifyInstance} app */
export default async function roleRoutes(app) {
  const tags = ['admin'];
  const permission = P.admin.roles;

  app.get(
    '/permissions',
    {
      config: { permission },
      schema: {
        tags,
        summary: 'All permission keys',
        response: {
          200: z.array(
            z.object({
              key: z.string(),
              module: z.string(),
              action: z.string(),
              sensitive: z.boolean(),
            }),
          ),
        },
      },
    },
    async () => ALL_PERMISSIONS,
  );

  app.get(
    '/roles',
    {
      config: { permission },
      schema: { tags, summary: 'Roles with permissions', response: { 200: z.array(zRole) } },
    },
    async (request) => app.db.read(loadRoles, request.txOpts('roles.list')),
  );

  app.post(
    '/roles',
    {
      config: { permission },
      schema: {
        tags,
        summary: 'Create a role',
        body: zRoleBody.extend({
          code: z
            .string()
            .trim()
            .regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'Upper-case code, max 30'),
        }),
        response: { 201: zRole },
      },
    },
    async (request, reply) => {
      const role = await app.db.withTx(async (tx) => {
        const b = request.body;
        const keys = checkKeys(b.permissions);
        const exists = await tx.one('SELECT COUNT(*) AS N FROM APP_ROLE WHERE ROLE_CODE = :c', {
          c: b.code,
        });
        if (exists.N > 0) throw Errors.duplicate(`Role ${b.code} already exists`);
        await tx.exec(
          `INSERT INTO APP_ROLE (ROLE_CODE, ROLE_NAME, DESCR, IS_SYSTEM, ACTIVE) VALUES (:c, :n, :d, 'N', :a)`,
          { c: b.code, n: b.name, d: b.descr ?? null, a: b.active ? 'Y' : 'N' },
        );
        await replacePermissions(tx, b.code, keys);
        await recordAudit(tx, request.ctx(), {
          entity: 'APP_ROLE',
          key: b.code,
          action: 'CREATE',
          newValues: { ...b, permissions: keys },
        });
        return (await loadRoles(tx)).find((r) => r.code === b.code);
      }, request.txOpts('roles.create'));
      return reply.status(201).send(role);
    },
  );

  app.put(
    '/roles/:code',
    {
      config: { permission },
      schema: {
        tags,
        summary: 'Update a role and its permissions',
        params: z.object({ code: z.string().max(30) }),
        body: zRoleBody,
        response: { 200: zRole },
      },
    },
    async (request) =>
      app.db.withTx(async (tx) => {
        const { code } = request.params;
        const before = (await loadRoles(tx)).find((r) => r.code === code);
        if (!before) throw Errors.notFound('Role');
        if (
          code === 'SYS_ADMIN' &&
          !(await hasRoleAnywhere(tx, request.session.userId, 'SYS_ADMIN'))
        ) {
          throw Errors.forbidden('Only a system administrator can change SYS_ADMIN');
        }
        const keys = checkKeys(request.body.permissions);
        await tx.exec(
          `UPDATE APP_ROLE SET ROLE_NAME = :n, DESCR = :d, ACTIVE = :a WHERE ROLE_CODE = :c`,
          {
            c: code,
            n: request.body.name,
            d: request.body.descr ?? null,
            a: request.body.active ? 'Y' : 'N',
          },
        );
        await replacePermissions(tx, code, keys);
        const added = keys.filter((k) => !before.permissions.includes(k));
        const removed = before.permissions.filter((k) => !keys.includes(k));
        await recordAudit(tx, request.ctx(), {
          entity: 'APP_ROLE_PERMISSION',
          key: code,
          action: 'UPDATE',
          oldValues: { name: before.name, active: before.active, removed },
          newValues: { name: request.body.name, active: request.body.active, added },
        });
        return (await loadRoles(tx)).find((r) => r.code === code);
      }, request.txOpts('roles.update')),
  );
}
