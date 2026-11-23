// /api/v1/plant/* (API_SPEC §11, TASKS P3). Device-callable routes are marked `device: true`
// (PERMISSIONS P-6: only their own branch).
import { P, zReason } from '@dcl/shared';
import { z } from 'zod';
import { Errors } from '../../lib/errors.js';
import { SettingsReader } from '../settings/service.js';
import { receiveReading } from './readings.js';
import * as scan from './scan.js';

const zReading = z.object({
  deviceId: z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,39}$/),
  readingId: z.string().regex(/^[A-Za-z0-9-]{8,60}$/),
  weightKg: z.number().int().min(0).max(200000),
  stable: z.boolean(),
  readOn: z.string().max(40),
  signature: z.string().min(20).max(100),
});

const zArea = z.object({
  lnkno: z.number(),
  areaDoc: z.string(),
  areaName: z.string().nullable().optional(),
  qtyTon: z.string().nullable().optional(),
  remainingTon: z.string().nullable(),
});
const zCard = z.object({
  docType: z.enum(['DO', 'PMT']),
  docNo: z.string(),
  brnch: z.number(),
  ver: z.number(),
  status: z.string(),
  doType: z.string().optional(),
  doNo: z.string().optional(),
  ocNo: z.string().nullable().optional(),
  permitNo: z.string().optional(),
  customerCode: z.string(),
  customerName: z.string().nullable(),
  productCode: z.string().nullable(),
  destName: z.string().nullable(),
  qtyType: z.string().nullable().optional(),
  qtyTon: z.string().nullable(),
  dispatchedTon: z.string().optional(),
  remainingTon: z.string().nullable(),
  holdReason: z.string().nullable(),
  areas: z.array(zArea),
});
const zEntry = zCard
  .pick({
    docType: true,
    docNo: true,
    ver: true,
    status: true,
    customerCode: true,
    customerName: true,
    productCode: true,
    destName: true,
    qtyType: true,
    remainingTon: true,
    holdReason: true,
  })
  .extend({ sig: z.string(), areas: z.array(zArea) });

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

  /** Branch of the gate: the device's, or the signed-in user's session branch. */
  const plantBrnch = (request) => request.device?.brnch ?? request.session.brnch;

  app.post(
    '/plant/scan',
    {
      config: { permission: P.gate.view, device: true },
      schema: {
        tags,
        summary:
          'Check a scanned DO/permit QR (BR-QR-02/03) → document card, or 422 with data.reason',
        body: z.object({ qr: z.string().min(5).max(300) }),
        response: { 200: zCard },
      },
    },
    async (request) =>
      app.db.read(
        (tx) =>
          scan.scan(
            tx,
            { qrSecret: app.config.QR_SECRET, plantBrnch: plantBrnch(request) },
            request.body.qr,
          ),
        request.txOpts('plant.scan'),
      ),
  );

  app.post(
    '/plant/lookup',
    {
      config: { permission: P.gate.manual_lookup },
      schema: {
        tags,
        summary: 'Find a DO/permit by number without its QR (BR-GATE-01); reason required, audited',
        body: z.object({
          docType: z.enum(['DO', 'PMT']),
          docNo: z
            .string()
            .trim()
            .regex(/^[A-Z0-9.-]{3,30}$/, 'DO or permit number'),
          reason: zReason,
        }),
        response: { 200: z.object({ items: z.array(zCard) }) },
      },
    },
    async (request) =>
      app.db.withTx(
        (tx) => scan.lookup(tx, request.ctx(), plantBrnch(request), request.body),
        request.txOpts('plant.lookup'),
      ),
  );

  app.get(
    '/plant/offline-cache',
    {
      config: { permission: P.gate.view, device: true },
      schema: {
        tags,
        summary:
          'Open DOs/permits of the branch for offline QR checks (BR-OFF-02); each entry has its QR signature. ETag / If-None-Match → 304',
        response: {
          200: z.object({
            brnch: z.number(),
            generatedAt: z.date(),
            refreshMin: z.number(),
            etag: z.string(),
            entries: z.array(zEntry),
          }),
        },
      },
    },
    async (request, reply) => {
      const brnch = plantBrnch(request);
      const res = await app.db.read(async (tx) => {
        const refreshMin = (await new SettingsReader(tx).num(brnch, 'OFFLINE_CACHE_MIN')) ?? 5;
        return scan.offlineCache(tx, {
          qrSecret: app.config.QR_SECRET,
          brnch,
          now: app.clock.now(),
          refreshMin,
        });
      }, request.txOpts('plant.offline-cache'));
      const tag = `"${res.etag}"`;
      reply.header('etag', tag);
      reply.header('cache-control', 'private, no-cache');
      if (request.headers['if-none-match'] === tag) return reply.status(304).send();
      return res;
    },
  );
}
