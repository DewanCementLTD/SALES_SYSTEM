// GET /api/v1/admin/outbox — failed and dead notifications/jobs stay visible (BR-NTF-02, P0-13).
import { P, zPage, zPageQuery } from '@dcl/shared';
import { z } from 'zod';
import { branchFilter } from '../../lib/branch-scope.js';
import { paginate } from '../../lib/oracle/paginate.js';

const zRow = z.object({
  outboxId: z.number(),
  brnch: z.number().nullable(),
  eventType: z.string(),
  aggregateKey: z.string().nullable(),
  channel: z.string(),
  recipient: z.string().nullable(),
  status: z.string(),
  tries: z.number(),
  nextTryOn: z.date(),
  lastError: z.string().nullable(),
  createdOn: z.date(),
  sentOn: z.date().nullable(),
});

/** @param {import('fastify').FastifyInstance} app */
export default async function outboxRoutes(app) {
  app.get(
    '/outbox',
    {
      config: { permission: P.admin.settings },
      schema: {
        tags: ['admin'],
        summary: 'Outbox rows (notifications and background jobs)',
        querystring: zPageQuery.extend({
          status: z.enum(['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DEAD']).optional(),
        }),
        response: { 200: zPage(zRow) },
      },
    },
    async (request) => {
      const branches = await request.authz.branchesWith(P.admin.settings);
      const bf = branchFilter('BRNCH', branches);
      const binds = { ...bf.binds };
      let where = `(${bf.sql} OR BRNCH IS NULL)`;
      if (request.query.status) {
        where += ' AND STATUS = :st';
        binds.st = request.query.status;
      }
      const res = await app.db.read(
        (tx) =>
          paginate(tx, {
            sql: `SELECT OUTBOX_ID, BRNCH, EVENT_TYPE, AGGREGATE_KEY, CHANNEL, RECIPIENT, STATUS, TRIES, NEXT_TRY_ON,
                         LAST_ERROR, CREATED_ON, SENT_ON
                    FROM NOTIFICATION_OUTBOX WHERE ${where} ORDER BY OUTBOX_ID DESC`,
            binds,
            page: request.query.page,
            pageSize: request.query.pageSize,
          }),
        request.txOpts('outbox.list'),
      );
      return {
        ...res,
        items: res.items.map((r) => ({
          outboxId: r.OUTBOX_ID,
          brnch: r.BRNCH,
          eventType: r.EVENT_TYPE,
          aggregateKey: r.AGGREGATE_KEY,
          channel: r.CHANNEL,
          recipient: r.RECIPIENT,
          status: r.STATUS,
          tries: r.TRIES,
          nextTryOn: r.NEXT_TRY_ON,
          lastError: r.LAST_ERROR,
          createdOn: r.CREATED_ON,
          sentOn: r.SENT_ON,
        })),
      };
    },
  );
}
