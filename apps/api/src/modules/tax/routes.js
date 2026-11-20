// /api/v1/tax/* (API_SPEC §4 Tax, TASKS P1-05). Decisions go through Approvals (rule RATE_CHANGE).
import { P, zIsoDate, zProductPeriodRequest, zTaxRateRequest } from '@dcl/shared';
import { z } from 'zod';
import { Errors } from '../../lib/errors.js';
import * as svc from './service.js';

const zRate = z.object({
  taxRateId: z.number(),
  brnch: z.number(),
  kind: z.string(),
  filerStatus: z.string(),
  section: z.string(),
  ratePct: z.string(),
  effectiveFrom: z.string(),
  remarks: z.string().nullable(),
  status: z.string(),
  createdBy: z.string(),
  createdOn: z.date(),
  approvedBy: z.string().nullable(),
  approvedOn: z.date().nullable(),
});

/** @param {import('fastify').FastifyInstance} app */
export default async function taxRoutes(app) {
  const tags = ['tax'];
  const actor = (request) => ({
    usrid: request.session.usrid,
    audit: request.ctx(),
    now: app.clock.now(),
    brnch: request.session.brnch,
  });
  const myBranches = (request) => request.authz.branchesWith(P.tax.view);

  app.get(
    '/tax/rates',
    {
      config: { permission: P.tax.view },
      schema: {
        tags,
        summary: 'Withholding-tax rates (all versions; both-branches rows have brnch 0)',
        response: { 200: z.object({ items: z.array(zRate) }) },
      },
    },
    async (request) => {
      const branches = await myBranches(request);
      return app.db.read(
        async (tx) => ({ items: await svc.listRates(tx, branches) }),
        request.txOpts('tax.rates'),
      );
    },
  );

  app.get(
    '/tax/rates/effective',
    {
      config: { permission: P.tax.view },
      schema: {
        tags,
        summary: 'WHT rate that applies on a date (BR-TAX-05)',
        querystring: z.object({
          filerStatus: z.enum(['F', 'N', 'E']),
          section: z.string().max(20).optional(),
          date: zIsoDate,
        }),
        response: { 200: z.object({ rate: zRate.nullable() }) },
      },
    },
    async (request) =>
      app.db.read(
        async (tx) => ({
          rate: await svc.effectiveRate(tx, { ...request.query, brnch: request.session.brnch }),
        }),
        request.txOpts('tax.effective'),
      ),
  );

  app.post(
    '/tax/rates',
    {
      config: { permission: P.tax.update },
      schema: {
        tags,
        summary: 'New WHT rate row (scope 0 = both branches) → approval RATE_CHANGE',
        body: zTaxRateRequest,
        response: { 201: z.object({ rate: zRate, requestId: z.number().nullable() }) },
      },
    },
    async (request, reply) => {
      const b = request.body.scope;
      if (b !== 0 && !(await request.authz.permissions(b)).has(P.tax.update))
        throw Errors.branchForbidden(b);
      const res = await app.db.withTx(
        (tx) => svc.requestRate(tx, actor(request), request.body),
        request.txOpts('tax.rate'),
      );
      return reply.status(201).send(res);
    },
  );

  app.get(
    '/tax/product-periods/pending',
    {
      config: { permission: P.tax.view },
      schema: {
        tags,
        summary: 'FED / sales-tax period changes waiting for approval (current branch)',
        response: { 200: z.object({ items: z.array(z.record(z.string(), z.unknown())) }) },
      },
    },
    async (request) =>
      app.db.read(
        async (tx) => ({ items: await svc.pendingPeriods(tx, request.session.brnch) }),
        request.txOpts('tax.pending'),
      ),
  );

  app.post(
    '/tax/product-periods',
    {
      config: { permission: P.tax.update },
      schema: {
        tags,
        summary: 'New FED / sales-tax period for a product (BR-TAX-10) → approval RATE_CHANGE',
        body: zProductPeriodRequest,
        response: {
          201: z.object({ requestId: z.number().nullable(), period: z.number().nullable() }),
        },
      },
    },
    async (request, reply) => {
      const res = await app.db.withTx(
        (tx) => svc.requestProductPeriod(tx, actor(request), request.session.brnch, request.body),
        request.txOpts('tax.period'),
      );
      return reply.status(201).send(res);
    },
  );
}
