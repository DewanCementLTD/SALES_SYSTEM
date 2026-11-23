// /api/v1/do/* (API_SPEC §10, TASKS P2-06). Commands carry If-Match with the row version.
import { DO_STATUS, P, zBrnch, zIsoDate, zPageQuery, zReason } from '@dcl/shared';
import { z } from 'zod';
import { resolveListBranches } from '../../lib/branch-scope.js';
import { etag, ifMatch } from '../../lib/http.js';
import { enqueue } from '../outbox/service.js';
import * as reprice from './reprice.js';
import * as svc from './service.js';

const zParams = z.object({
  brnch: zBrnch,
  doType: z.string().regex(/^[A-Z0-9]{1,10}$/, 'Not a DO type'),
  doNo: z.string().regex(/^\d{1,11}$/, 'Not a DO number'),
});
const zN = z.string().nullable();
const zDo = z.object({
  brnch: z.number(),
  doType: z.string(),
  doTypeName: zN,
  doNo: z.string(),
  ocNo: zN,
  srfNo: zN,
  srNo: z.number().nullable(),
  year: z.number().nullable(),
  issueDate: zN,
  schedDate: zN,
  customerCode: zN,
  customerName: zN,
  customerAddress: zN,
  customerMobile: zN,
  productCode: zN,
  qtyType: zN,
  bags: z.number().nullable(),
  qtyTon: z.string(),
  dispatchedTon: z.string(),
  remainingTon: z.string(),
  rate: zN,
  value: zN,
  priceCode: zN,
  destGeoCode: zN,
  destName: zN,
  rateLockUntil: z.date().nullable(),
  qrVer: z.number().nullable(),
  holdReason: zN,
  holdShortfall: zN,
  status: z.string(),
  rowVer: z.number(),
  createdBy: zN,
  createdOn: z.date().nullable(),
  cancelReason: zN,
  cancelledBy: zN,
  cancelledOn: z.date().nullable(),
  sentToDealerOn: z.date().nullable(),
  instructions: zN,
});

/** @param {import('fastify').FastifyInstance} app */
export default async function doRoutes(app) {
  const tags = ['do'];
  const actor = (request) => ({
    usrid: request.session.usrid,
    now: app.clock.now(),
    audit: request.ctx(),
  });

  app.get(
    '/do',
    {
      config: { permission: P.do.view },
      schema: {
        tags,
        summary: 'Delivery orders of my branches; outstanding=true → open DOs (R10)',
        querystring: zPageQuery.extend({
          brnch: z.union([z.literal('all'), z.coerce.number().int()]).optional(),
          status: z.enum(/** @type {[string, ...string[]]} */ (Object.keys(DO_STATUS))).optional(),
          customer: z.string().max(11).optional(),
          oc: z
            .string()
            .regex(/^\d{1,9}$/)
            .optional(),
          from: zIsoDate.optional(),
          to: zIsoDate.optional(),
          outstanding: z.enum(['true', 'false']).optional(),
        }),
        response: {
          200: z.object({
            items: z.array(zDo),
            page: z.number(),
            pageSize: z.number(),
            total: z.number(),
          }),
        },
      },
    },
    async (request) => {
      const { brnch, outstanding, ...rest } = request.query;
      const branches = resolveListBranches(
        {
          brnch: request.session.brnch,
          allowedBranches: await request.authz.branchesWith(P.do.view),
        },
        brnch,
      );
      return app.db.read(
        (tx) => svc.list(tx, { branches, ...rest, outstanding: outstanding === 'true' }),
        request.txOpts('do.list'),
      );
    },
  );

  app.get(
    '/do/:brnch/:doType/:doNo',
    {
      config: { permission: P.do.view },
      schema: { tags, summary: 'One DO', params: zParams, response: { 200: zDo } },
    },
    async (request, reply) => {
      const { brnch, doType, doNo } = request.params;
      const d = await app.db.read(
        (tx) => svc.getDo(tx, brnch, doType, doNo),
        request.txOpts('do.get'),
      );
      reply.header('etag', etag(d.rowVer));
      return d;
    },
  );

  const command = (path, perm, body, summary, fn, response) =>
    app.post(
      `/do/:brnch/:doType/:doNo/${path}`,
      {
        config: { permission: perm },
        schema: { tags, summary, params: zParams, body, response: { 200: response } },
      },
      async (request) => {
        const { brnch, doType, doNo } = request.params;
        return app.db.withTx(
          (tx) => fn(tx, actor(request), brnch, doType, doNo, request),
          request.txOpts(`do.${path}`),
        );
      },
    );

  command(
    'cancel',
    P.do.cancel,
    z.object({ reason: zReason }),
    'Cancel (reason); through the DO_CANCEL approval when active; releases the undispatched value (BR-DO-05)',
    (tx, a, b, t, n, r) => svc.cancelDo(tx, a, b, t, n, ifMatch(r), r.body.reason),
    z.object({ do: zDo, requestId: z.number().nullable(), released: zN }),
  );
  command(
    'hold',
    P.do.hold_release,
    z.object({
      reason: zReason,
      shortfall: z
        .string()
        .regex(/^\d{1,14}(\.\d{1,2})?$/)
        .nullable()
        .optional(),
    }),
    'Put on hold (cannot be dispatched, BR-DO-07)',
    (tx, a, b, t, n, r) => svc.holdDo(tx, a, b, t, n, ifMatch(r), r.body),
    zDo,
  );
  command(
    'release',
    P.do.hold_release,
    z.object({}),
    'Release a held DO',
    (tx, a, b, t, n, r) => svc.releaseDo(tx, a, b, t, n, ifMatch(r)),
    zDo,
  );
  command(
    'send',
    P.do.resend,
    z.object({ channels: z.array(z.enum(['SMS', 'WHATSAPP', 'EMAIL'])).min(1) }),
    'Send / resend to the dealer (queued; delivered by the notification processors)',
    (tx, a, b, t, n, r) => svc.sendDo(tx, a, b, t, n, r.body.channels),
    z.object({ outboxIds: z.array(z.number()) }),
  );

  app.post(
    '/do/:brnch/:doType/:doNo/print',
    {
      config: { permission: P.do.print },
      schema: {
        tags,
        summary:
          'Queue the DO PDF (signed QR, barcode, CANCELLED watermark); file in GET /files?entity=DELIVERY_ORDER&key={brnch}|{doType}|{doNo}',
        params: zParams,
        response: { 202: z.object({ outboxId: z.number(), entityKey: z.string() }) },
      },
    },
    async (request, reply) => {
      const { brnch, doType, doNo } = request.params;
      const now = app.clock.now();
      const entityKey = svc.keyOf(brnch, doType, doNo);
      const res = await app.db.withTx(async (tx) => {
        const data = await svc.printData(tx, brnch, doType, doNo);
        return enqueue(tx, {
          brnch,
          eventType: 'PDF_RENDER',
          aggregateType: 'DELIVERY_ORDER',
          aggregateKey: entityKey,
          channel: 'JOB',
          dedupKey: `PDF_RENDER|DO|${entityKey}|${now.getTime()}`,
          payload: {
            template: 'delivery-order',
            entity: 'DELIVERY_ORDER',
            entityKey,
            fileName: `do-${doNo}.pdf`,
            data,
          },
          now,
        });
      }, request.txOpts('do.print'));
      return reply.status(202).send({ outboxId: res.outboxId, entityKey });
    },
  );

  const zReprice = z.object({
    productCode: z.string().trim().min(1).max(4),
    priceCode: z.string().trim().max(10).optional(),
    customerCode: z.string().trim().max(11).optional(),
    newRate: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'Rate: a number with up to 2 decimals'),
    effectiveFrom: zIsoDate,
  });
  app.post(
    '/reprice/preview',
    {
      config: { permission: P.do.reprice },
      schema: {
        tags,
        summary: 'Open DOs past their rate lock with old/new rate and shortfall (BR-PRC-07/08)',
        body: zReprice,
      },
    },
    async (request) =>
      app.db.read(
        (tx) => reprice.preview(tx, request.session.brnch, request.body, app.clock.now()),
        request.txOpts('reprice.preview'),
      ),
  );
  app.post(
    '/reprice/apply',
    {
      config: { permission: P.do.reprice },
      schema: {
        tags,
        summary: 'Put the DOs with a shortfall ON_HOLD and notify Sales (BR-PRC-08)',
        body: zReprice,
      },
    },
    async (request) =>
      app.db.withTx(
        (tx) => reprice.apply(tx, actor(request), request.session.brnch, request.body),
        request.txOpts('reprice.apply'),
      ),
  );
}
