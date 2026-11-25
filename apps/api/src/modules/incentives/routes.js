// /api/v1/incentives (API_SPEC §14, TASKS P4-03): incentive schemes, run preview and commit.
import { P, zBrnch, zIncentiveScheme, zPageQuery, zReason } from '@dcl/shared';
import { z } from 'zod';
import { resolveListBranches } from '../../lib/branch-scope.js';
import { etag, ifMatch } from '../../lib/http.js';
import * as svc from './service.js';

const tags = ['incentives'];
const zN = z.string().nullable();
const zParams = z.object({ brnch: zBrnch, srlNo: z.string().regex(/^\d{1,8}$/) });
const zSchemeRow = z.object({
  brnch: z.number(),
  srlNo: z.string(),
  memoNo: zN,
  memoDate: z.string(),
  dateFrom: z.string(),
  dateTo: z.string(),
  customerFrom: z.string(),
  customerTo: z.string(),
  remarks: zN,
  status: z.string(),
  rowVer: z.number(),
  total: zN,
  createdBy: zN,
  createdOn: z.date().nullable(),
  committedBy: zN,
  committedOn: z.date().nullable(),
  cancelReason: zN,
});
const zScheme = zSchemeRow.extend({
  products: z.array(z.object({ productCode: z.string(), productName: zN, rate: z.string() })),
  details: z.array(
    z.object({
      srNo: z.number(),
      customerCode: z.string(),
      customerName: zN,
      productCode: z.string(),
      qtyTon: z.string(),
      rate: z.string(),
      amount: z.string(),
    }),
  ),
  notes: z.array(
    z.object({ srlNo: z.string(), customerCode: z.string(), net: z.string(), status: z.string() }),
  ),
});
const zPreview = z.object({
  scheme: zScheme,
  qtyTon: z.string(),
  amount: z.string(),
  customers: z.array(
    z.object({
      customerCode: z.string(),
      customerName: zN,
      qtyTon: z.string(),
      amount: z.string(),
      lines: z.array(
        z.object({
          productCode: z.string(),
          qtyTon: z.string(),
          rate: z.string(),
          amount: z.string(),
          paidBy: zN,
        }),
      ),
    }),
  ),
});
const zRunBody = z.object({ srlNo: z.string().regex(/^\d{1,8}$/) });

/** @param {import('fastify').FastifyInstance} app */
export default async function incentiveRoutes(app) {
  const actor = (request) => ({
    usrid: request.session.usrid,
    now: app.clock.now(),
    audit: request.ctx(),
  });

  app.get(
    '/incentives/schemes',
    {
      config: { permission: P.incentive.view },
      schema: {
        tags,
        summary: 'Incentive schemes of my branches, newest first',
        querystring: zPageQuery.extend({
          brnch: z.union([z.literal('all'), z.coerce.number().int()]).optional(),
          status: z.enum(['DRAFT', 'COMMITTED', 'CANCELLED']).optional(),
        }),
        response: {
          200: z.object({
            items: z.array(zSchemeRow),
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
          allowedBranches: await request.authz.branchesWith(P.incentive.view),
        },
        brnch,
      );
      return app.db.read(
        (tx) => svc.listSchemes(tx, { branches, ...rest }),
        request.txOpts('incentives.list'),
      );
    },
  );

  app.get(
    '/incentives/schemes/:brnch/:srlNo',
    {
      config: { permission: P.incentive.view },
      schema: {
        tags,
        summary: 'One scheme with products; committed: detail rows and its credit notes',
        params: zParams,
        response: { 200: zScheme },
      },
    },
    async (request, reply) => {
      const s = await app.db.read(
        (tx) => svc.getScheme(tx, request.params.brnch, request.params.srlNo),
        request.txOpts('incentives.get'),
      );
      reply.header('etag', etag(s.rowVer));
      return s;
    },
  );

  app.post(
    '/incentives/schemes',
    {
      config: { permission: P.incentive.run },
      schema: {
        tags,
        summary:
          'New DRAFT scheme of my branch (BR-INC-01): period, customer code range, products with a rate per ton',
        body: zIncentiveScheme,
        response: { 201: zScheme },
      },
    },
    async (request, reply) => {
      const s = await app.db.withTx(
        (tx) => svc.createScheme(tx, actor(request), request.session.brnch, request.body),
        request.txOpts('incentives.create'),
      );
      reply.header('etag', etag(s.rowVer));
      return reply.status(201).send(s);
    },
  );

  app.post(
    '/incentives/schemes/:brnch/:srlNo/cancel',
    {
      config: { permission: P.incentive.run },
      schema: {
        tags,
        summary: 'Cancel a draft scheme (If-Match; the number stays used)',
        params: zParams,
        body: z.object({ reason: zReason }),
        response: { 200: zScheme },
      },
    },
    async (request) =>
      app.db.withTx(
        (tx) =>
          svc.cancelScheme(
            tx,
            actor(request),
            request.params.brnch,
            request.params.srlNo,
            ifMatch(request),
            request.body.reason,
          ),
        request.txOpts('incentives.cancel'),
      ),
  );

  app.post(
    '/incentives/runs/preview',
    {
      config: { permission: P.incentive.run },
      schema: {
        tags,
        summary:
          'Preview a scheme of my branch: invoiced tons per customer and product × rate; paidBy = already paid by an overlapping committed scheme (BR-INC-03)',
        body: zRunBody,
        response: { 200: zPreview },
      },
    },
    async (request) =>
      app.db.read(
        (tx) => svc.preview(tx, request.session.brnch, request.body.srlNo),
        request.txOpts('incentives.preview'),
      ),
  );

  app.post(
    '/incentives/runs/commit',
    {
      config: { permission: P.incentive.commit },
      schema: {
        tags,
        summary:
          'Commit a draft scheme of my branch (If-Match): INCENTIVE_DETAIL + one DRAFT credit note per customer (BR-INC-01/03)',
        body: zRunBody,
        response: { 200: zScheme },
      },
    },
    async (request) =>
      app.db.withTx(
        (tx) =>
          svc.commit(
            tx,
            actor(request),
            request.session.brnch,
            request.body.srlNo,
            ifMatch(request),
          ),
        request.txOpts('incentives.commit'),
      ),
  );
}
