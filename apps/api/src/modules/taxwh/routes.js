// /api/v1/tax-withheld (TASKS P4-05): tax withheld by customers and certificates received.
// note.view / note.create until a tax-withheld permission is agreed (see service.js).
import { P, zIsoDate, zPageQuery, zReason, zTaxCertificate, zTaxWithheldCreate } from '@dcl/shared';
import { z } from 'zod';
import { resolveListBranches } from '../../lib/branch-scope.js';
import { Errors } from '../../lib/errors.js';
import * as svc from './service.js';

const tags = ['tax-withheld'];
const zN = z.string().nullable();
const zEntry = z.object({
  twId: z.number(),
  brnch: z.number(),
  customerCode: z.string(),
  customerName: zN,
  taxKind: z.enum(['IT', 'ST']),
  docType: zN,
  docNo: zN,
  date: z.string(),
  amount: z.string(),
  certReceived: z.string(),
  outstanding: z.string(),
  remarks: zN,
  createdBy: z.string(),
  createdOn: z.date(),
  reversedBy: z.number().nullable(),
});
const zId = z.object({ twId: z.coerce.number().int().positive() });

/** @param {import('fastify').FastifyInstance} app */
export default async function taxWithheldRoutes(app) {
  const actor = (request) => ({
    usrid: request.session.usrid,
    now: app.clock.now(),
    audit: request.ctx(),
  });

  app.get(
    '/tax-withheld',
    {
      config: { permission: P.note.view },
      schema: {
        tags,
        summary: 'Tax withheld entries of my branches, newest first',
        querystring: zPageQuery.extend({
          brnch: z.union([z.literal('all'), z.coerce.number().int()]).optional(),
          customer: z.string().max(11).optional(),
          kind: z.enum(['IT', 'ST']).optional(),
          from: zIsoDate.optional(),
          to: zIsoDate.optional(),
        }),
        response: {
          200: z.object({
            items: z.array(zEntry),
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
          allowedBranches: await request.authz.branchesWith(P.note.view),
        },
        brnch,
      );
      return app.db.read((tx) => svc.list(tx, { branches, ...rest }), request.txOpts('taxwh.list'));
    },
  );

  app.get(
    '/tax-withheld/summary',
    {
      config: { permission: P.note.view },
      schema: {
        tags,
        summary:
          'Per customer and tax kind (my branch): withheld, certificates received, outstanding',
        querystring: z.object({ asOf: zIsoDate.optional() }),
        response: {
          200: z.object({
            items: z.array(
              z.object({
                customerCode: z.string(),
                customerName: zN,
                taxKind: z.enum(['IT', 'ST']),
                amount: z.string(),
                certReceived: z.string(),
                outstanding: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => ({
      items: await app.db.read(
        (tx) => svc.summary(tx, { brnch: request.session.brnch, asOf: request.query.asOf }),
        request.txOpts('taxwh.summary'),
      ),
    }),
  );

  app.post(
    '/tax-withheld',
    {
      config: { permission: P.note.create },
      schema: {
        tags,
        summary: 'Record tax withheld by a customer of my branch (IT / ST)',
        body: zTaxWithheldCreate,
        response: { 201: zEntry },
      },
    },
    async (request, reply) => {
      const e = await app.db.withTx(
        (tx) => svc.create(tx, actor(request), request.session.brnch, request.body),
        request.txOpts('taxwh.create'),
      );
      return reply.status(201).send(e);
    },
  );

  /** entry of a branch where the user holds note.create, else 404 */
  const onEntry = (path, body, summary, fn) =>
    app.post(
      `/tax-withheld/:twId/${path}`,
      {
        config: { permission: P.note.create },
        schema: { tags, summary, params: zId, body, response: { 200: zEntry } },
      },
      async (request) =>
        app.db.withTx(
          async (tx) => {
            const e = await svc.getEntry(tx, request.params.twId);
            if (!(await request.authz.permissions(e.brnch)).has(P.note.create))
              throw Errors.notFound(`Tax withheld entry ${request.params.twId}`);
            return fn(tx, actor(request), request.params.twId, request.body);
          },
          request.txOpts(`taxwh.${path}`),
        ),
    );

  onEntry(
    'certificate',
    zTaxCertificate,
    'Add a certificate received against the entry (total never above the amount withheld)',
    (tx, a, id, b) => svc.addCertificate(tx, a, id, b),
  );
  onEntry(
    'reverse',
    z.object({ reason: zReason }),
    'Cancel a wrong entry with a reversing entry (no certificate on it yet) → the reversing entry',
    (tx, a, id, b) => svc.reverse(tx, a, id, b.reason),
  );
}
