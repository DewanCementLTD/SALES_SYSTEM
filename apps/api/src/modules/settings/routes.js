// /api/v1/admin/settings (API_SPEC §3, TASKS P0-11). Company level (BRNCH 0) only for SYS_ADMIN.
import { P, SETTINGS } from '@dcl/shared';
import { z } from 'zod';
import { encryptSecret } from '../../lib/crypto.js';
import { Errors } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import { hasRoleAnywhere } from '../users/repo.js';
import { listSettings, settingValueProblem } from './service.js';

const zLevel = z.coerce
  .number()
  .int()
  .refine((b) => [0, 1, 2].includes(b), 'Use 0 (company), 1 or 2');

const zSetting = z.object({
  key: z.string(),
  type: z.string(),
  rule: z.string(),
  openQuestion: z.string().nullable(),
  description: z.string(),
  perBranch: z.boolean(),
  secret: z.boolean(),
  companyValue: z.string().nullable(),
  branchValue: z.string().nullable(),
  value: z.string().nullable(),
  source: z.enum(['branch', 'company', 'default']),
  updatedBy: z.string().nullable(),
  updatedOn: z.date().nullable(),
});

/** @param {import('fastify').FastifyInstance} app */
export default async function settingsRoutes(app) {
  const tags = ['admin'];

  app.get(
    '/settings',
    {
      config: { permission: P.admin.settings },
      schema: {
        tags,
        summary: 'Settings for company (0) or a branch',
        querystring: z.object({ level: zLevel.default(0) }),
        response: { 200: z.array(zSetting) },
      },
    },
    async (request) => {
      const { level } = request.query;
      if (level !== 0 && !(await request.authz.allowedBranches()).includes(level))
        throw Errors.branchForbidden(level);
      return app.db.read((tx) => listSettings(tx, level), request.txOpts('settings.list'));
    },
  );

  app.put(
    '/settings/:level/:key',
    {
      config: { permission: P.admin.settings },
      schema: {
        tags,
        summary:
          'Set a value (empty = remove branch override is not supported; set the value instead)',
        params: z.object({ level: zLevel, key: z.string().max(50) }),
        body: z.object({ value: z.string().max(4000).nullable() }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      const { level, key } = request.params;
      const def = SETTINGS[key];
      if (!def) throw Errors.notFound('Setting');
      const problem = settingValueProblem(key, request.body.value);
      if (problem) throw Errors.validation(problem, [{ path: 'body.value', message: problem }]);
      // secrets (FBR token …) are stored encrypted with APP_ENC_KEY (ARCHITECTURE §7)
      const value =
        def.secret && request.body.value
          ? encryptSecret(request.body.value, app.config.APP_ENC_KEY)
          : request.body.value;
      await app.db.withTx(async (tx) => {
        if (level === 0) {
          if (!(await hasRoleAnywhere(tx, request.session.userId, 'SYS_ADMIN'))) {
            throw Errors.forbidden('Only a system administrator can change company-level settings');
          }
        } else {
          const perms = await request.authz.permissions(level);
          if (!perms.has(P.admin.settings))
            throw Errors.forbidden(`You need admin.settings in branch ${level}`);
        }
        const old = await tx.one(
          'SELECT SETTING_VALUE FROM APP_SETTING WHERE BRNCH = :b AND SETTING_KEY = :k FOR UPDATE',
          {
            b: level,
            k: key,
          },
        );
        if (old) {
          await tx.exec(
            `UPDATE APP_SETTING SET SETTING_VALUE = :v, UPDATED_BY = :ub, UPDATED_ON = :now WHERE BRNCH = :b AND SETTING_KEY = :k`,
            {
              b: level,
              k: key,
              v: value,
              ub: request.session.usrid,
              now: app.clock.now(),
            },
          );
        } else {
          await tx.exec(
            `INSERT INTO APP_SETTING (BRNCH, SETTING_KEY, SETTING_VALUE, VALUE_TYPE, DESCR, UPDATED_BY, UPDATED_ON)
             VALUES (:b, :k, :v, :t, :d, :ub, :now)`,
            {
              b: level,
              k: key,
              v: value,
              t: def.type,
              d: def.descr,
              ub: request.session.usrid,
              now: app.clock.now(),
            },
          );
        }
        await recordAudit(tx, request.ctx(), {
          entity: 'APP_SETTING',
          key: `${level}|${key}`,
          action: 'UPDATE',
          brnch: level || null,
          oldValues: { value: def.secret ? '[secret]' : (old?.SETTING_VALUE ?? null) },
          newValues: { value: def.secret ? '[secret]' : request.body.value },
        });
      }, request.txOpts('settings.update'));
      return { ok: true };
    },
  );
}
