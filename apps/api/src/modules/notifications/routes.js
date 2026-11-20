// In-app notifications for staff (API_SPEC §15, BR-NTF-03): the bell in the top bar.
import { z } from 'zod';

const zNote = z.object({
  id: z.number(),
  brnch: z.number().nullable(),
  title: z.string(),
  body: z.string().nullable(),
  link: z.string().nullable(),
  severity: z.string(),
  readOn: z.date().nullable(),
  createdOn: z.date(),
});

/** @param {import('fastify').FastifyInstance} app */
export default async function notificationRoutes(app) {
  const tags = ['notifications'];

  app.get(
    '/',
    {
      config: { allowMustChange: true },
      schema: {
        tags,
        summary: 'My latest notifications',
        querystring: z.object({ unread: z.coerce.boolean().optional() }),
        response: { 200: z.object({ items: z.array(zNote), unread: z.number() }) },
      },
    },
    async (request) =>
      app.db.read(async (tx) => {
        const u = request.session.userId;
        const rows = await tx.many(
          `SELECT * FROM (
             SELECT NOTIF_ID, BRNCH, TITLE, BODY, LINK, SEVERITY, READ_ON, CREATED_ON FROM USER_NOTIFICATION
              WHERE USER_ID = :u ${request.query.unread ? 'AND READ_ON IS NULL' : ''}
              ORDER BY CREATED_ON DESC, NOTIF_ID DESC
           ) WHERE ROWNUM <= 50`,
          { u },
        );
        const c = await tx.one(
          'SELECT COUNT(*) AS N FROM USER_NOTIFICATION WHERE USER_ID = :u AND READ_ON IS NULL',
          { u },
        );
        return {
          items: rows.map((r) => ({
            id: r.NOTIF_ID,
            brnch: r.BRNCH,
            title: r.TITLE,
            body: r.BODY,
            link: r.LINK,
            severity: r.SEVERITY,
            readOn: r.READ_ON,
            createdOn: r.CREATED_ON,
          })),
          unread: c.N,
        };
      }, request.txOpts('notifications.list')),
  );

  app.post(
    '/:id/read',
    {
      schema: {
        tags,
        summary: 'Mark one as read',
        params: z.object({ id: z.coerce.number().int() }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      await app.db.withTx(
        (tx) =>
          tx.exec(
            'UPDATE USER_NOTIFICATION SET READ_ON = :now WHERE NOTIF_ID = :id AND USER_ID = :u AND READ_ON IS NULL',
            {
              id: request.params.id,
              u: request.session.userId,
              now: app.clock.now(),
            },
          ),
        request.txOpts('notifications.read'),
      );
      return { ok: true };
    },
  );

  app.post(
    '/read-all',
    {
      schema: {
        tags,
        summary: 'Mark all as read',
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      await app.db.withTx(
        (tx) =>
          tx.exec(
            'UPDATE USER_NOTIFICATION SET READ_ON = :now WHERE USER_ID = :u AND READ_ON IS NULL',
            {
              u: request.session.userId,
              now: app.clock.now(),
            },
          ),
        request.txOpts('notifications.read-all'),
      );
      return { ok: true };
    },
  );
}
