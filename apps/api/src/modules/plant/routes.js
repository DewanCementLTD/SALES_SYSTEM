// /api/v1/plant/* (API_SPEC §11, TASKS P3). Device-callable routes are marked `device: true`
// (PERMISSIONS P-6: only their own branch).
import { z } from 'zod';
import { Errors } from '../../lib/errors.js';
import { receiveReading } from './readings.js';

const zReading = z.object({
  deviceId: z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,39}$/),
  readingId: z.string().regex(/^[A-Za-z0-9-]{8,60}$/),
  weightKg: z.number().int().min(0).max(200000),
  stable: z.boolean(),
  readOn: z.string().max(40),
  signature: z.string().min(20).max(100),
});

const zReceived = z.object({ readingId: z.string(), receivedOn: z.date(), duplicate: z.boolean() });

/** @param {import('fastify').FastifyInstance} app */
export default async function plantRoutes(app) {
  const tags = ['plant'];

  app.post(
    '/plant/weigh-readings',
    {
      config: { device: true },
      schema: {
        tags,
        summary:
          'Weighbridge agent upload of a captured stable reading, signed over DCL-WGT|device|reading|kg|stable|readOn (BR-WGT-01)',
        body: zReading,
        response: { 200: zReceived, 201: zReceived },
      },
    },
    async (request, reply) => {
      if (!request.device) throw Errors.forbidden('Only the weighbridge agent uploads readings');
      const res = await app.db.withTx(
        (tx) =>
          receiveReading(
            tx,
            { encKey: app.config.APP_ENC_KEY, now: app.clock.now() },
            request.device,
            request.body,
          ),
        request.txOpts('plant.weigh-reading'),
      );
      return reply.status(res.duplicate ? 200 : 201).send(res);
    },
  );
}
