// /api/v1/srf/* (API_SPEC §6, TASKS P2-01). Commands carry If-Match with the row version.
import { P, SRF_STATUS, zBrnch, zIsoDate, zPageQuery, zReason, zSrfBody } from '@dcl/shared';
import { z } from 'zod';
import { resolveListBranches } from '../../lib/branch-scope.js';
import { etag, ifMatch } from '../../lib/http.js';
import { enqueue } from '../outbox/service.js';
import * as repo from './repo.js';
import * as svc from './service.js';

const zNo = z.string().regex(/^\d{1,14}$/, 'Not an SRF number');
const zParams = z.object({ brnch: zBrnch, srfNo: zNo });
const zN = z.string().nullable();

const zSrf = z.object({
  brnch: z.number(),
  srfNo: z.string(),
  year: z.number().nullable(),
  srfDate: zN,
  customerCode: z.string(),
  customerName: zN,
  customerZone: zN,
  productCode: z.string(),
  destGeoCode: zN,
  destName: zN,
  bagCode: z.number().nullable(),
  bagColour: z.number().nullable(),
  qtyTon: zN,
  bags: z.number().nullable(),
  modeOfDelivery: zN,
  modeOfTransport: zN,
  localExport: z.string(),
  termOfSale: z.string(),
  specialInstructions: zN,
  remarks: zN,
  doHandoverTo: zN,
  taxProfile: z.object({ stType: zN, strn: zN, ntn: zN, cnic: zN }),
  export: z.object({ piNo: zN, formE: zN, lcNo: zN }).nullable(),
  legalRequirements: zN,
  crRemarks: zN,
  contractValidTo: zN,
  ocNo: zN,
  status: z.string(),
  rowVer: z.number(),
  createdBy: zN,
  createdOn: z.date().nullable(),
  updatedBy: zN,
  updatedOn: z.date().nullable(),
  approvedBy: zN,
  cancelReason: zN,
  cancelledBy: zN,
  cancelledOn: z.date().nullable(),
});
const zSrfFull = zSrf.extend({
  schedule: z.array(z.object({ srNo: z.number(), date: zN, qtyTon: zN })),
});

/** @param {import('fastify').FastifyInstance} app */
export default async function srfRoutes(app) {
  const tags = ['srf'];
  const actor = (request) => ({
    usrid: request.session.usrid,
    now: app.clock.now(),
    audit: request.ctx(),
  });

  app.get(
    '/srf',
    {
      config: { permission: P.srf.view },
      schema: {
        tags,
        summary: 'SRFs of my branches (newest first)',
        querystring: zPageQuery.extend({
          brnch: z.union([z.literal('all'), z.coerce.number().int()]).optional(),
          status: z.enum(/** @type {[string, ...string[]]} */ (Object.keys(SRF_STATUS))).optional(),
          customer: z.string().max(11).optional(),
          from: zIsoDate.optional(),
          to: zIsoDate.optional(),
        }),
        response: {
          200: z.object({
            items: z.array(zSrf),
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
          allowedBranches: await request.authz.branchesWith(P.srf.view),
        },
        brnch,
      );
      return app.db.read((tx) => repo.list(tx, { branches, ...rest }), request.txOpts('srf.list'));
    },
  );

  app.get(
    '/srf/:brnch/:srfNo',
    {
      config: { permission: P.srf.view },
      schema: { tags, summary: 'SRF with schedule', params: zParams, response: { 200: zSrfFull } },
    },
    async (request, reply) => {
      const srf = await app.db.read(
        (tx) => svc.getSrf(tx, request.params.brnch, request.params.srfNo),
        request.txOpts('srf.get'),
      );
      reply.header('etag', etag(srf.rowVer));
      return srf;
    },
  );

  app.post(
    '/srf',
    {
      config: { permission: P.srf.create },
      schema: {
        tags,
        summary: 'New SRF (DRAFT). Tax fields default from the customer (BR-SRF-04)',
        body: zSrfBody.and(z.object({ brnch: zBrnch })),
        response: { 201: zSrfFull },
      },
    },
    async (request, reply) => {
      const { brnch, ...body } = request.body;
      const srf = await app.db.withTx(
        (tx) => svc.createSrf(tx, actor(request), brnch, body),
        request.txOpts('srf.create'),
      );
      reply.header('etag', etag(srf.rowVer));
      return reply.status(201).send(srf);
    },
  );

  app.put(
    '/srf/:brnch/:srfNo',
    {
      config: { permission: P.srf.update },
      schema: {
        tags,
        summary: 'Replace a DRAFT SRF (If-Match)',
        params: zParams,
        body: zSrfBody,
        response: { 200: zSrfFull },
      },
    },
    async (request, reply) => {
      const { brnch, srfNo } = request.params;
      const ver = ifMatch(request);
      const srf = await app.db.withTx(
        (tx) => svc.updateSrf(tx, actor(request), brnch, srfNo, ver, request.body),
        request.txOpts('srf.update'),
      );
      reply.header('etag', etag(srf.rowVer));
      return srf;
    },
  );

  app.post(
    '/srf/:brnch/:srfNo/submit',
    {
      config: { permission: P.srf.create },
      schema: {
        tags,
        summary: 'Submit → creates the draft OC with prices from the trade price (BR-SRF-05)',
        params: zParams,
        response: {
          200: z.object({
            srf: zSrfFull,
            oc: z.object({
              ocNo: z.string(),
              priced: z.boolean(),
              priceCode: zN,
              value: z.string(),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const { brnch, srfNo } = request.params;
      const ver = ifMatch(request);
      const res = await app.db.withTx(
        (tx) => svc.submitSrf(tx, actor(request), brnch, srfNo, ver),
        request.txOpts('srf.submit'),
      );
      reply.header('etag', etag(res.srf.rowVer));
      return res;
    },
  );

  app.post(
    '/srf/:brnch/:srfNo/cancel',
    {
      config: { permission: P.srf.cancel },
      schema: {
        tags,
        summary: 'Cancel (reason); cancels the draft OC too (BR-SRF-06)',
        params: zParams,
        body: z.object({ reason: zReason }),
        response: { 200: zSrfFull },
      },
    },
    async (request, reply) => {
      const { brnch, srfNo } = request.params;
      const ver = ifMatch(request);
      const srf = await app.db.withTx(
        (tx) => svc.cancelSrf(tx, actor(request), brnch, srfNo, ver, request.body.reason),
        request.txOpts('srf.cancel'),
      );
      reply.header('etag', etag(srf.rowVer));
      return srf;
    },
  );

  app.post(
    '/srf/:brnch/:srfNo/contract-review',
    {
      config: { permission: P.srf.print },
      schema: {
        tags,
        summary:
          'Queue the Contract Review Form PDF (BR-SRF-07); the file appears in GET /files?entity=SALES_REQUEST_MASTER&key={brnch}|{srfNo}',
        params: zParams,
        response: { 202: z.object({ outboxId: z.number(), entityKey: z.string() }) },
      },
    },
    async (request, reply) => {
      const { brnch, srfNo } = request.params;
      const now = app.clock.now();
      const entityKey = `${brnch}|${srfNo}`;
      const res = await app.db.withTx(async (tx) => {
        const data = await svc.contractReviewData(tx, brnch, srfNo);
        return enqueue(tx, {
          brnch,
          eventType: 'PDF_RENDER',
          aggregateType: 'SALES_REQUEST_MASTER',
          aggregateKey: entityKey,
          channel: 'JOB',
          dedupKey: `PDF_RENDER|CRF|${entityKey}|${now.getTime()}`,
          payload: {
            template: 'contract-review',
            entity: 'SALES_REQUEST_MASTER',
            entityKey,
            fileName: `contract-review-${srfNo}.pdf`,
            data,
          },
          now,
        });
      }, request.txOpts('srf.contract-review'));
      return reply.status(202).send({ outboxId: res.outboxId, entityKey });
    },
  );
}
