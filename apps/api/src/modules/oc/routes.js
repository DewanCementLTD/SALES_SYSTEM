// /api/v1/oc/* (API_SPEC §7, TASKS P2-03). Commands carry If-Match with the row version.
import {
  OC_STATUS,
  P,
  zBrnch,
  zIsoDate,
  zOcBrvLinks,
  zOcConfirm,
  zOcOverrideRequest,
  zOcPrices,
  zOcUpdate,
  zPageQuery,
  zReason,
} from '@dcl/shared';
import { z } from 'zod';
import { resolveListBranches } from '../../lib/branch-scope.js';
import { Errors } from '../../lib/errors.js';
import { etag, ifMatch } from '../../lib/http.js';
import * as repo from './repo.js';
import * as svc from './service.js';

const zParams = z.object({
  brnch: zBrnch,
  ocNo: z.string().regex(/^\d{1,9}$/, 'Not an OC number'),
});
const zN = z.string().nullable();
const zPrices = z.object({
  retailPrice: z.string(),
  tradeDisc: z.string(),
  salesTax: z.string(),
  fed: z.string(),
  consPrice: z.string(),
  expense: z.string(),
  discount: z.string(),
});
const zOc = z.object({
  brnch: z.number(),
  ocNo: z.string(),
  srfNo: zN,
  year: z.number().nullable(),
  orderDate: zN,
  customerCode: z.string(),
  customerName: zN,
  productCode: zN,
  qtyTon: zN,
  priceCode: zN,
  destGeoCode: zN,
  destName: zN,
  prices: zPrices,
  netPrice: z.string(),
  value: z.string(),
  remarks: zN,
  salesTaxType: zN,
  priceOverride: z.string(),
  masterPrices: z.record(z.string(), z.any()).nullable(),
  status: z.string(),
  rowVer: z.number(),
  createdBy: zN,
  createdOn: z.date().nullable(),
  updatedBy: zN,
  updatedOn: z.date().nullable(),
  reviewedBy: zN,
  approvedBy: zN,
  approvedOn: z.date().nullable(),
  confirmedBy: zN,
  confirmedOn: z.date().nullable(),
  overrideReqId: z.number().nullable(),
  cancelReason: zN,
  cancelledBy: zN,
  cancelledOn: z.date().nullable(),
});
const zDo = z.object({
  doType: z.string(),
  doNo: z.string(),
  srNo: z.number().nullable(),
  schedDate: zN,
  qtyTon: z.string(),
  rate: zN,
  value: zN,
  dispatchedTon: z.string(),
  status: z.string(),
});
const zOcFull = zOc.extend({
  schedule: z.array(z.object({ srNo: z.number(), date: zN, qtyTon: zN })),
  brvs: z.array(
    z.object({
      serno: z.number(),
      receiptNo: z.string(),
      amount: zN,
      brvDate: zN,
      brvAmount: zN,
      chequeNo: zN,
      brvStatus: z.string(),
      remarks: zN,
    }),
  ),
  dos: z.array(zDo),
});

/** @param {import('fastify').FastifyInstance} app */
export default async function ocRoutes(app) {
  const tags = ['oc'];
  const actor = (request) => ({
    usrid: request.session.usrid,
    now: app.clock.now(),
    audit: request.ctx(),
  });

  app.get(
    '/oc',
    {
      config: { permission: P.oc.view },
      schema: {
        tags,
        summary: 'Order confirmations of my branches (newest first)',
        querystring: zPageQuery.extend({
          brnch: z.union([z.literal('all'), z.coerce.number().int()]).optional(),
          status: z.enum(/** @type {[string, ...string[]]} */ (Object.keys(OC_STATUS))).optional(),
          customer: z.string().max(11).optional(),
          from: zIsoDate.optional(),
          to: zIsoDate.optional(),
        }),
        response: {
          200: z.object({
            items: z.array(zOc),
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
          allowedBranches: await request.authz.branchesWith(P.oc.view),
        },
        brnch,
      );
      return app.db.read((tx) => repo.list(tx, { branches, ...rest }), request.txOpts('oc.list'));
    },
  );

  app.get(
    '/oc/:brnch/:ocNo',
    {
      config: { permission: P.oc.view },
      schema: {
        tags,
        summary: 'OC with schedule, BRV links, DOs; DO types and linkable BRVs for the screen',
        params: zParams,
        response: {
          200: zOcFull.extend({
            doTypes: z.array(
              z.object({ value: z.string(), label: z.string(), lastUsed: z.boolean() }),
            ),
            linkableBrvs: z.array(
              z.object({
                receiptNo: z.string(),
                brvDate: zN,
                amount: zN,
                free: z.string(),
                chequeNo: zN,
                status: zN,
              }),
            ),
          }),
        },
      },
    },
    async (request, reply) => {
      const { brnch, ocNo } = request.params;
      const oc = await app.db.read(async (tx) => {
        const o = await svc.getOc(tx, brnch, ocNo);
        return {
          ...o,
          doTypes: await svc.doTypesFor(tx, brnch, o),
          linkableBrvs: await repo.linkableBrvs(tx, brnch, o.customerCode),
        };
      }, request.txOpts('oc.get'));
      reply.header('etag', etag(oc.rowVer));
      return oc;
    },
  );

  app.get(
    '/oc/:brnch/:ocNo/balance',
    {
      config: { permission: P.customer.view_balance },
      schema: {
        tags,
        summary: 'Live balance for the OC: available, OC value, shortfall (BR-BAL-01/03/05)',
        params: zParams,
      },
    },
    async (request) => {
      const { brnch, ocNo } = request.params;
      return app.db.read(async (tx) => {
        const oc = await repo.get(tx, brnch, ocNo);
        if (!oc) throw Errors.notFound(`OC ${ocNo}`);
        return svc.ocBalance(tx, oc, app.clock.now());
      }, request.txOpts('oc.balance'));
    },
  );

  app.post(
    '/oc/:brnch/:ocNo/price-preview',
    {
      config: { permission: P.oc.view },
      schema: {
        tags,
        summary:
          'Breakdown for proposed prices (no save); lists fields that differ from the master',
        params: zParams,
        body: z.object({ prices: zOcPrices, qtyTon: z.string().optional() }),
      },
    },
    async (request) => {
      const { brnch, ocNo } = request.params;
      const oc = await app.db.read((tx) => repo.get(tx, brnch, ocNo), request.txOpts('oc.preview'));
      if (!oc) throw Errors.notFound(`OC ${ocNo}`);
      return svc.pricePreview(oc, request.body.prices, request.body.qtyTon);
    },
  );

  app.put(
    '/oc/:brnch/:ocNo',
    {
      config: { permission: P.oc.update },
      schema: {
        tags,
        summary: 'Edit quantity, schedule, prices, remarks while DRAFT/REVIEWED (BR-OC-02)',
        params: zParams,
        body: zOcUpdate,
        response: { 200: zOcFull },
      },
    },
    async (request, reply) => {
      const { brnch, ocNo } = request.params;
      const oc = await app.db.withTx(
        (tx) => svc.updateOc(tx, actor(request), brnch, ocNo, ifMatch(request), request.body),
        request.txOpts('oc.update'),
      );
      reply.header('etag', etag(oc.rowVer));
      return oc;
    },
  );

  const command = (path, perm, body, summary, fn, response = zOcFull) =>
    app.post(
      `/oc/:brnch/:ocNo/${path}`,
      {
        config: { permission: perm },
        schema: { tags, summary, params: zParams, body, response: { 200: response } },
      },
      async (request, reply) => {
        const { brnch, ocNo } = request.params;
        const res = await app.db.withTx(
          (tx) => fn(tx, actor(request), brnch, ocNo, request),
          request.txOpts(`oc.${path}`),
        );
        const ver = res.oc?.rowVer ?? res.rowVer;
        if (ver !== undefined) reply.header('etag', etag(ver));
        return res;
      },
    );

  command(
    'review',
    P.oc.review,
    z.object({}),
    'Sales/Finance review (BR-OC-04)',
    (tx, a, b, n, r) => svc.reviewOc(tx, a, b, n, ifMatch(r)),
  );
  command(
    'approve',
    P.oc.approve,
    z.object({}),
    'Approve; a price override must be approved first (BR-OC-02/04)',
    (tx, a, b, n, r) => svc.approveOc(tx, a, b, n, ifMatch(r)),
  );
  command(
    'reject',
    P.oc.approve,
    z.object({ reason: zReason }),
    'Reject: back to DRAFT with reason (BR-OC-04)',
    (tx, a, b, n, r) => svc.rejectOc(tx, a, b, n, ifMatch(r), r.body.reason),
  );
  app.put(
    '/oc/:brnch/:ocNo/brvs',
    {
      config: { permission: P.oc.update },
      schema: {
        tags,
        summary: 'Replace the BRVs funding the OC (verified BRVs only, BR-OC-05)',
        params: zParams,
        body: zOcBrvLinks,
        response: { 200: zOcFull },
      },
    },
    async (request, reply) => {
      const { brnch, ocNo } = request.params;
      const oc = await app.db.withTx(
        (tx) =>
          svc.setBrvLinks(tx, actor(request), brnch, ocNo, ifMatch(request), request.body.links),
        request.txOpts('oc.brvs'),
      );
      reply.header('etag', etag(oc.rowVer));
      return oc;
    },
  );
  command(
    'confirm',
    P.oc.confirm,
    zOcConfirm,
    'Confirm: balance check with the customer locked, one DO per schedule line (BR-OC-06/07)',
    (tx, a, b, n, r) => svc.confirmOc(tx, a, b, n, ifMatch(r), r.body),
    z.object({
      oc: zOcFull,
      dos: z.array(
        z.object({
          doType: z.string(),
          doNo: z.string(),
          srNo: z.number(),
          qtyTon: z.string(),
          rate: z.string(),
          value: z.string(),
        }),
      ),
      balanceAfter: z.string(),
    }),
  );
  app.post(
    '/oc/:brnch/:ocNo/request-override',
    {
      config: { permission: [P.oc.balance_override, P.oc.price_override] },
      schema: {
        tags,
        summary: 'Ask for a balance (BR-BAL-04) or price (BR-OC-02) override → approval request',
        params: zParams,
        body: zOcOverrideRequest,
        response: { 200: z.object({ requestId: z.number().nullable(), oc: zOcFull }) },
      },
    },
    async (request) => {
      const { brnch, ocNo } = request.params;
      const need = request.body.kind === 'BALANCE' ? P.oc.balance_override : P.oc.price_override;
      if (!(await request.authz.permissions(brnch)).has(need))
        throw Errors.forbidden(`You need ${need} to do this`);
      return app.db.withTx(
        (tx) => svc.requestOverride(tx, actor(request), brnch, ocNo, request.body),
        request.txOpts('oc.override'),
      );
    },
  );
  command(
    'cancel',
    P.oc.cancel,
    z.object({ reason: zReason }),
    'Cancel with reason; undispatched DOs are cancelled and released (BR-OC-08)',
    (tx, a, b, n, r) => svc.cancelOc(tx, a, b, n, ifMatch(r), r.body.reason),
  );
  command('duplicate', P.oc.create, z.object({}), 'New DRAFT copy (BR-OC-09)', (tx, a, b, n) =>
    svc.duplicateOc(tx, a, b, n),
  );
}
