// /api/v1/cancellations (PRD 4.14, TASKS P2-08): order cancellation advices (DO/OC cancels) and
// receipt cancellation advices (BRV bounces and cancels). Read-only: the advices are written by
// the cancelling commands.
import { P, zPageQuery } from '@dcl/shared';
import { z } from 'zod';
import { resolveListBranches } from '../../lib/branch-scope.js';
import { Errors } from '../../lib/errors.js';
import * as svc from './service.js';

/** @param {import('fastify').FastifyInstance} app */
export default async function cancellationRoutes(app) {
  app.get(
    '/cancellations',
    {
      config: { permission: [P.do.view, P.brv.view] },
      schema: {
        tags: ['cancellations'],
        summary: 'Cancellation advices: kind=order (DO/OC) or receipt (BRV bounce/cancel)',
        querystring: zPageQuery.extend({
          kind: z.enum(['order', 'receipt']).default('order'),
          brnch: z.union([z.literal('all'), z.coerce.number().int()]).optional(),
        }),
      },
    },
    async (request) => {
      const { kind, brnch, ...rest } = request.query;
      const perm = kind === 'order' ? P.do.view : P.brv.view;
      const allowed = await request.authz.branchesWith(perm);
      if (!allowed.length) throw Errors.forbidden(`You need ${perm} to see these advices`);
      const branches = resolveListBranches(
        { brnch: request.session.brnch, allowedBranches: allowed },
        brnch,
      );
      return app.db.read(
        (tx) =>
          kind === 'order'
            ? svc.listOrderAdvices(tx, { branches, ...rest })
            : svc.listReceiptAdvices(tx, { branches, ...rest }),
        request.txOpts('cancellations.list'),
      );
    },
  );
}
