// /api/v1/permits/* (API_SPEC §9, TASKS P2-05). Permit numbers carry the branch suffix
// (e.g. 20272301.2). Commands carry If-Match with the row version.
import {
  P,
  PERMIT_STATUS,
  zBrnch,
  zIsoDate,
  zPageQuery,
  zPermitAdjust,
  zPermitBody,
  zReason,
} from '@dcl/shared';
import { z } from 'zod';
import { resolveListBranches } from '../../lib/branch-scope.js';
import { etag, ifMatch } from '../../lib/http.js';
import { enqueue } from '../outbox/service.js';
import { printTexts } from '../texts/service.js';
import * as svc from './service.js';

const zParams = z.object({
  brnch: zBrnch,
  permitNo: z.string().regex(/^\d{1,12}(\.\d)?$/, 'Not a permit number'),
});
const zN = z.string().nullable();
const zPermit = z.object({
  brnch: z.number(),
  permitNo: z.string(),
  permitDate: zN,
  validFrom: zN,
  validTo: zN,
  customerCode: zN,
  customerName: zN,
  productCode: zN,
  qtyTon: zN,
  value: zN,
  year: z.number().nullable(),
  legacyBalances: z.object({ doBalance: zN, dcBalance: zN, creditLimit: zN }).nullable(),
  status: z.string(),
  rowVer: z.number(),
  createdBy: z.string(),
  createdOn: z.date().nullable(),
  issuedBy: zN,
  issuedOn: z.date().nullable(),
  cfoReqId: z.number().nullable(),
  overrideReqId: z.number().nullable(),
  cancelReason: zN,
  cancelledBy: zN,
  cancelledOn: z.date().nullable(),
  sentToDealerOn: z.date().nullable(),
  qrVer: z.number(),
});
const zPermitFull = zPermit.extend({
  areas: z.array(
    z.object({
      lnkno: z.number(),
      areaDoc: z.string(),
      areaName: zN,
      qtyTon: z.string(),
      rate: z.string(),
      amount: z.string(),
      dispatchedTon: z.string(),
      balanceTon: z.string(),
      status: z.string(),
      rateOverride: z.boolean(),
      sheetRate: zN,
    }),
  ),
  adjustments: z.array(
    z.object({
      serno: z.number(),
      date: zN,
      lnkno: z.number().nullable(),
      areaDoc: zN,
      qtyTon: z.string(),
      rate: zN,
      amount: zN,
    }),
  ),
});

/** @param {import('fastify').FastifyInstance} app */
export default async function permitRoutes(app) {
  const tags = ['permits'];
  const actor = (request) => ({
    usrid: request.session.usrid,
    now: app.clock.now(),
    audit: request.ctx(),
  });

  app.get(
    '/permits',
    {
      config: { permission: P.permit.view },
      schema: {
        tags,
        summary: 'Permits of my branches (newest first)',
        querystring: zPageQuery.extend({
          brnch: z.union([z.literal('all'), z.coerce.number().int()]).optional(),
          status: z
            .enum(/** @type {[string, ...string[]]} */ (Object.keys(PERMIT_STATUS)))
            .optional(),
          customer: z.string().max(15).optional(),
          from: zIsoDate.optional(),
          to: zIsoDate.optional(),
        }),
        response: {
          200: z.object({
            items: z.array(zPermit),
            page: z.number(),
            pageSize: z.number(),
            total: z.number(),
          }),
        },
      },
    },
    async (request) => {
      const { brnch, ...rest } = request.query;
      const branches = resolveListBranches(
        {
          brnch: request.session.brnch,
          allowedBranches: await request.authz.branchesWith(P.permit.view),
        },
        brnch,
      );
      return app.db.read(
        (tx) => svc.list(tx, { branches, ...rest }),
        request.txOpts('permits.list'),
      );
    },
  );

  app.get(
    '/permits/city-rates',
    {
      config: { permission: P.permit.view },
      schema: {
        tags,
        summary:
          'City rates of a product on a date: approved rate sheet, rate = booking − last freight (BR-PMT-01)',
        querystring: z.object({ product: z.string().max(10), date: zIsoDate }),
      },
    },
    async (request) =>
      app.db.read(
        (tx) => svc.cityRates(tx, request.session.brnch, request.query.product, request.query.date),
        request.txOpts('permits.rates'),
      ),
  );

  app.get(
    '/permits/:brnch/:permitNo',
    {
      config: { permission: P.permit.view },
      schema: {
        tags,
        summary: 'Permit with areas and adjustments',
        params: zParams,
        response: { 200: zPermitFull },
      },
    },
    async (request, reply) => {
      const { brnch, permitNo } = request.params;
      const p = await app.db.read(
        (tx) => svc.getPermit(tx, brnch, permitNo),
        request.txOpts('permits.get'),
      );
      reply.header('etag', etag(p.rowVer));
      return p;
    },
  );

  app.post(
    '/permits',
    {
      config: { permission: P.permit.create },
      schema: {
        tags,
        summary: 'New permit (DRAFT); area rates from the rate sheet unless given (override)',
        body: zPermitBody.and(z.object({ brnch: zBrnch })),
        response: { 201: zPermitFull },
      },
    },
    async (request, reply) => {
      const { brnch, ...body } = request.body;
      const p = await app.db.withTx(
        (tx) => svc.createPermit(tx, actor(request), brnch, body),
        request.txOpts('permits.create'),
      );
      reply.header('etag', etag(p.rowVer));
      return reply.status(201).send(p);
    },
  );

  app.put(
    '/permits/:brnch/:permitNo',
    {
      config: { permission: P.permit.update },
      schema: {
        tags,
        summary: 'Edit a DRAFT permit (If-Match)',
        params: zParams,
        body: zPermitBody,
        response: { 200: zPermitFull },
      },
    },
    async (request, reply) => {
      const { brnch, permitNo } = request.params;
      const p = await app.db.withTx(
        (tx) =>
          svc.updatePermit(tx, actor(request), brnch, permitNo, ifMatch(request), request.body),
        request.txOpts('permits.update'),
      );
      reply.header('etag', etag(p.rowVer));
      return p;
    },
  );

  const command = (path, perm, body, summary, fn, response) =>
    app.post(
      `/permits/:brnch/:permitNo/${path}`,
      {
        config: { permission: perm },
        schema: { tags, summary, params: zParams, body, response: { 200: response } },
      },
      async (request) => {
        const { brnch, permitNo } = request.params;
        return app.db.withTx(
          (tx) => fn(tx, actor(request), brnch, permitNo, request),
          request.txOpts(`permits.${path}`),
        );
      },
    );

  command(
    'issue',
    P.permit.issue,
    z.object({}),
    'Issue: balance check with the customer locked; debits the DO ledger (BR-PMT-02)',
    (tx, a, b, n, r) => svc.issuePermit(tx, a, b, n, ifMatch(r)),
    z.object({ permit: zPermitFull, balanceAfter: z.string() }),
  );
  command(
    'send-cfo',
    P.permit.send_cfo,
    z.object({ reason: zReason }),
    'Send to the CFO (approval PERMIT_CFO, BR-PMT-03)',
    (tx, a, b, n, r) => svc.sendToCfo(tx, a, b, n, ifMatch(r), r.body.reason),
    z.object({ permit: zPermitFull, requestId: z.number() }),
  );
  command(
    'request-override',
    P.permit.balance_override,
    z.object({ reason: zReason }),
    'Ask for a balance override (PERMIT_BALANCE_OVERRIDE, BR-BAL-04)',
    (tx, a, b, n, r) => svc.requestBalanceOverride(tx, a, b, n, r.body.reason),
    z.object({ permit: zPermitFull, requestId: z.number() }),
  );
  command(
    'adjust',
    P.permit.adjust,
    zPermitAdjust,
    'Adjust area quantities of an issued permit (reason; balance re-checked on increase, BR-PMT-06)',
    (tx, a, b, n, r) => svc.adjustPermit(tx, a, b, n, ifMatch(r), r.body),
    zPermitFull,
  );
  command(
    'send',
    P.permit.share,
    z.object({ channels: z.array(z.enum(['SMS', 'WHATSAPP', 'EMAIL'])).min(1) }),
    'Send / resend an issued permit to the dealer (queued; BR-NTF-01)',
    (tx, a, b, n, r) => svc.sendPermit(tx, a, b, n, r.body.channels),
    z.object({ outboxIds: z.array(z.number()) }),
  );
  command(
    'cancel',
    P.permit.cancel,
    z.object({ reason: zReason }),
    'Cancel (reason); undispatched value released (BR-PMT-07)',
    (tx, a, b, n, r) => svc.cancelPermit(tx, a, b, n, ifMatch(r), r.body.reason),
    zPermitFull,
  );

  app.post(
    '/permits/:brnch/:permitNo/print',
    {
      config: { permission: P.permit.print },
      schema: {
        tags,
        summary:
          'Queue the permit PDF; file in GET /files?entity=PERMIT_MST_CITY&key={brnch}|{permitNo}',
        params: zParams,
        response: { 202: z.object({ outboxId: z.number(), entityKey: z.string() }) },
      },
    },
    async (request, reply) => {
      const { brnch, permitNo } = request.params;
      const now = app.clock.now();
      const entityKey = `${brnch}|${permitNo}`;
      const res = await app.db.withTx(async (tx) => {
        const p = await svc.getPermit(tx, brnch, permitNo);
        const terms = await printTexts(tx, brnch, 'PERMIT_TERMS');
        return enqueue(tx, {
          brnch,
          eventType: 'PDF_RENDER',
          aggregateType: 'PERMIT_MST_CITY',
          aggregateKey: entityKey,
          channel: 'JOB',
          dedupKey: `PDF_RENDER|PMT|${entityKey}|${now.getTime()}`,
          payload: {
            template: 'permit',
            entity: 'PERMIT_MST_CITY',
            entityKey,
            fileName: `permit-${permitNo}.pdf`,
            data: { brnch, permit: p, terms },
          },
          now,
        });
      }, request.txOpts('permits.print'));
      return reply.status(202).send({ outboxId: res.outboxId, entityKey });
    },
  );
}
