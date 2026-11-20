// GET /api/v1/audit (API_SPEC §3, TASKS P0-10). Branch-scoped: rows of allowed branches and
// rows without a branch (e.g. company settings, failed logins of unknown users).
import { P, zIsoDate, zPage, zPageQuery } from '@dcl/shared';
import { z } from 'zod';
import { branchFilter } from '../../lib/branch-scope.js';
import { paginate } from '../../lib/oracle/paginate.js';

const zRow = z.object({
  auditId: z.number(),
  eventOn: z.date(),
  usrid: z.string().nullable(),
  brnch: z.number().nullable(),
  ip: z.string().nullable(),
  requestId: z.string().nullable(),
  entity: z.string(),
  entityKey: z.string(),
  action: z.string(),
  reason: z.string().nullable(),
  oldValues: z.unknown(),
  newValues: z.unknown(),
});

const parse = (s) => {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

/** @param {import('fastify').FastifyInstance} app */
export default async function auditRoutes(app) {
  app.get(
    '/',
    {
      config: { permission: P.audit.view },
      schema: {
        tags: ['audit'],
        summary: 'Audit log viewer',
        querystring: zPageQuery.extend({
          entity: z.string().max(30).optional(),
          key: z.string().max(200).optional(),
          user: z.string().max(20).optional(),
          action: z.string().max(30).optional(),
          from: zIsoDate.optional(),
          to: zIsoDate.optional(),
        }),
        response: { 200: zPage(zRow) },
      },
    },
    async (request) => {
      const q = request.query;
      const branches = await request.authz.branchesWith(P.audit.view);
      const bf = branchFilter('BRNCH', branches);
      const binds = { ...bf.binds };
      const where = [`(${bf.sql} OR BRNCH IS NULL)`];
      if (q.entity) {
        where.push('ENTITY = :entity');
        binds.entity = q.entity.toUpperCase();
      }
      if (q.key) {
        where.push('ENTITY_KEY = :ekey');
        binds.ekey = q.key;
      }
      if (q.user) {
        where.push('UPPER(USRID) = UPPER(:usr)');
        binds.usr = q.user;
      }
      if (q.action) {
        where.push('ACTION = :act');
        binds.act = q.action.toUpperCase();
      }
      if (q.from) {
        where.push(`EVENT_ON >= TO_TIMESTAMP(:dfrom, 'YYYY-MM-DD')`);
        binds.dfrom = q.from;
      }
      if (q.to) {
        where.push(`EVENT_ON < TO_TIMESTAMP(:dto, 'YYYY-MM-DD') + 1`);
        binds.dto = q.to;
      }
      const res = await app.db.read(
        (tx) =>
          paginate(tx, {
            sql: `SELECT AUDIT_ID, EVENT_ON, USRID, BRNCH, IP, REQUEST_ID, ENTITY, ENTITY_KEY, ACTION, REASON, OLD_VALUES, NEW_VALUES
                    FROM AUDIT_LOG WHERE ${where.join(' AND ')} ORDER BY EVENT_ON DESC, AUDIT_ID DESC`,
            binds,
            page: q.page,
            pageSize: q.pageSize,
          }),
        request.txOpts('audit.list'),
      );
      return {
        ...res,
        items: res.items.map((r) => ({
          auditId: r.AUDIT_ID,
          eventOn: r.EVENT_ON,
          usrid: r.USRID,
          brnch: r.BRNCH,
          ip: r.IP,
          requestId: r.REQUEST_ID,
          entity: r.ENTITY,
          entityKey: r.ENTITY_KEY,
          action: r.ACTION,
          reason: r.REASON,
          oldValues: parse(r.OLD_VALUES),
          newValues: parse(r.NEW_VALUES),
        })),
      };
    },
  );
}
