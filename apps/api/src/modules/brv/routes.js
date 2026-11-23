// /api/v1/brv/* (API_SPEC §8, TASKS P2-04). BRVs always have CASH_CHEQ_CD 'Q' (legacy data), so
// the key in paths is {brnch}/{receiptNo}. Commands carry If-Match with the row version.
import {
  BRV_STATUS,
  P,
  zBrnch,
  zBrvBody,
  zBrvBounce,
  zBrvClear,
  zBrvVerify,
  zIsoDate,
  zPageQuery,
  zReason,
} from '@dcl/shared';
import { z } from 'zod';
import { resolveListBranches } from '../../lib/branch-scope.js';
import { etag, ifMatch } from '../../lib/http.js';
import { enqueue } from '../outbox/service.js';
import * as repo from './repo.js';
import * as svc from './service.js';

const zParams = z.object({
  brnch: zBrnch,
  receiptNo: z.string().regex(/^\d{1,16}$/, 'Not a BRV number'),
});
const zN = z.string().nullable();
const zBrv = z.object({
  brnch: z.number(),
  receiptNo: z.string(),
  cashCheqCd: z.string(),
  year: z.number().nullable(),
  brvDate: zN,
  customerCode: zN,
  customerName: zN,
  instCode: zN,
  instrument: zN,
  category: zN,
  bankCode: zN,
  bankName: zN,
  chequeNo: zN,
  chequeDate: zN,
  depositAccount: zN,
  depositBank: zN,
  depositShort: zN,
  amount: zN,
  salesTax: zN,
  tax: zN,
  freight: zN,
  fundFrom: zN,
  transporter: zN,
  depositor: zN,
  city: zN,
  remarks: zN,
  clearDate: zN,
  returnDate: zN,
  appliedAmount: z.string(),
  status: z.string(),
  rowVer: z.number(),
  createdBy: zN,
  createdOn: z.date().nullable(),
  verifiedBy: zN,
  verifiedOn: z.date().nullable(),
  verifyMethod: zN,
  verifyRef: zN,
  verifyRemarks: zN,
  bouncedBy: zN,
  bouncedOn: z.date().nullable(),
  bounceReason: zN,
  cancelReason: zN,
  cancelledBy: zN,
  cancelledOn: z.date().nullable(),
});
const zPageOf = (item) =>
  z.object({ items: z.array(item), page: z.number(), pageSize: z.number(), total: z.number() });
const zListQuery = zPageQuery.extend({
  brnch: z.union([z.literal('all'), z.coerce.number().int()]).optional(),
  status: z.enum(/** @type {[string, ...string[]]} */ (Object.keys(BRV_STATUS))).optional(),
  customer: z.string().max(11).optional(),
  bank: z.string().max(6).optional(),
  from: zIsoDate.optional(),
  to: zIsoDate.optional(),
});

/** @param {import('fastify').FastifyInstance} app */
export default async function brvRoutes(app) {
  const tags = ['brv'];
  const actor = (request) => ({
    usrid: request.session.usrid,
    now: app.clock.now(),
    audit: request.ctx(),
  });
  const branchesFor = async (request, perm, requested) =>
    resolveListBranches(
      { brnch: request.session.brnch, allowedBranches: await request.authz.branchesWith(perm) },
      requested,
    );

  app.get(
    '/brv',
    {
      config: { permission: P.brv.view },
      schema: {
        tags,
        summary: 'BRVs of my branches (newest first)',
        querystring: zListQuery,
        response: { 200: zPageOf(zBrv) },
      },
    },
    async (request) => {
      const { brnch, ...rest } = request.query;
      const branches = await branchesFor(request, P.brv.view, brnch);
      return app.db.read((tx) => repo.list(tx, { branches, ...rest }), request.txOpts('brv.list'));
    },
  );

  app.get(
    '/brv/verification-queue',
    {
      config: { permission: P.brv.verify },
      schema: {
        tags,
        summary: 'ENTERED BRVs waiting for bank verification (oldest first)',
        querystring: zListQuery.omit({ status: true }),
        response: { 200: zPageOf(zBrv) },
      },
    },
    async (request) => {
      const { brnch, ...rest } = request.query;
      const branches = await branchesFor(request, P.brv.verify, brnch);
      return app.db.read(
        (tx) => repo.list(tx, { branches, ...rest, status: 'ENTERED', oldestFirst: true }),
        request.txOpts('brv.queue'),
      );
    },
  );

  app.get(
    '/brv/:brnch/:receiptNo',
    {
      config: { permission: P.brv.view },
      schema: {
        tags,
        summary: 'One BRV with linked OCs',
        params: zParams,
        response: {
          200: zBrv.extend({
            linkedOcs: z.array(z.object({ ocNo: z.string(), amount: zN, status: z.string() })),
          }),
        },
      },
    },
    async (request, reply) => {
      const { brnch, receiptNo } = request.params;
      const brv = await app.db.read(
        async (tx) => ({
          ...(await svc.getBrv(tx, brnch, receiptNo)),
          linkedOcs: await repo.linkedOcs(tx, brnch, receiptNo),
        }),
        request.txOpts('brv.get'),
      );
      reply.header('etag', etag(brv.rowVer));
      return brv;
    },
  );

  app.post(
    '/brv',
    {
      config: { permission: P.brv.create },
      schema: {
        tags,
        summary: 'New BRV (ENTERED; does not count toward balance until verified, BR-BRV-04)',
        body: zBrvBody.extend({ brnch: zBrnch }),
        response: { 201: zBrv },
      },
    },
    async (request, reply) => {
      const { brnch, ...body } = request.body;
      const brv = await app.db.withTx(
        (tx) => svc.createBrv(tx, actor(request), brnch, body),
        request.txOpts('brv.create'),
      );
      reply.header('etag', etag(brv.rowVer));
      return reply.status(201).send(brv);
    },
  );

  app.put(
    '/brv/:brnch/:receiptNo',
    {
      config: { permission: P.brv.update },
      schema: {
        tags,
        summary: 'Edit an ENTERED BRV (If-Match)',
        params: zParams,
        body: zBrvBody,
        response: { 200: zBrv },
      },
    },
    async (request, reply) => {
      const { brnch, receiptNo } = request.params;
      const brv = await app.db.withTx(
        (tx) => svc.updateBrv(tx, actor(request), brnch, receiptNo, ifMatch(request), request.body),
        request.txOpts('brv.update'),
      );
      reply.header('etag', etag(brv.rowVer));
      return brv;
    },
  );

  const command = (name, perm, body, summary, fn, response = zBrv) =>
    app.post(
      `/brv/:brnch/:receiptNo/${name}`,
      {
        config: { permission: perm },
        schema: { tags, summary, params: zParams, body, response: { 200: response } },
      },
      async (request, reply) => {
        const { brnch, receiptNo } = request.params;
        const res = await app.db.withTx(
          (tx) => fn(tx, actor(request), brnch, receiptNo, ifMatch(request), request.body),
          request.txOpts(`brv.${name}`),
        );
        reply.header('etag', etag((res.brv ?? res).rowVer));
        return res;
      },
    );

  command(
    'verify',
    P.brv.verify,
    zBrvVerify,
    'Bank verification (maker ≠ verifier); credits the DO and DC ledgers (BR-BRV-03/04)',
    svc.verifyBrv,
  );
  command('clear', P.brv.verify, zBrvClear, 'The bank cleared the instrument', svc.clearBrv);
  command(
    'bounce',
    P.brv.bounce,
    zBrvBounce,
    'Cheque returned: debits both ledgers, releases unconfirmed OC links (BR-BRV-05)',
    svc.bounceBrv,
    z.object({
      brv: zBrv,
      impact: z.object({
        releasedOcs: z.array(z.string()),
        confirmedOcs: z.array(z.string()),
        adviceNo: z.string().optional(),
      }),
    }),
  );
  command(
    'cancel',
    P.brv.cancel,
    z.object({ reason: zReason }),
    'Cancel while ENTERED (BR-BRV-06)',
    (tx, a, b, n, v, body) => svc.cancelBrv(tx, a, b, n, v, body.reason),
  );

  app.post(
    '/brv/:brnch/:receiptNo/receipt',
    {
      config: { permission: P.brv.print },
      schema: {
        tags,
        summary:
          'Queue the receipt PDF; the file appears in GET /files?entity=CASH_CHEQUE_RECEIPTS&key={brnch}|{receiptNo}',
        params: zParams,
        response: { 202: z.object({ outboxId: z.number(), entityKey: z.string() }) },
      },
    },
    async (request, reply) => {
      const { brnch, receiptNo } = request.params;
      const now = app.clock.now();
      const entityKey = `${brnch}|${receiptNo}`;
      const res = await app.db.withTx(async (tx) => {
        const brv = await svc.getBrv(tx, brnch, receiptNo);
        return enqueue(tx, {
          brnch,
          eventType: 'PDF_RENDER',
          aggregateType: 'CASH_CHEQUE_RECEIPTS',
          aggregateKey: entityKey,
          channel: 'JOB',
          dedupKey: `PDF_RENDER|BRV|${entityKey}|${now.getTime()}`,
          payload: {
            template: 'brv-receipt',
            entity: 'CASH_CHEQUE_RECEIPTS',
            entityKey,
            fileName: `brv-${receiptNo}.pdf`,
            data: { brnch, brv },
          },
          now,
        });
      }, request.txOpts('brv.receipt'));
      return reply.status(202).send({ outboxId: res.outboxId, entityKey });
    },
  );
}
