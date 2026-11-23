// /api/v1/plant/* (API_SPEC §11, TASKS P3). Device-callable routes are marked `device: true`
// (PERMISSIONS P-6: only their own branch).
import { P, zGateIn, zReason } from '@dcl/shared';
import { z } from 'zod';
import { Errors } from '../../lib/errors.js';
import { SettingsReader } from '../settings/service.js';
import { receiveReading } from './readings.js';
import * as gate from './gate.js';
import * as invoice from './invoice.js';
import * as scan from './scan.js';
import * as weighing from './weighing.js';

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

const zN = z.string().nullable();
const zNum = z.number().nullable();
const zGatePass = z.object({
  gpId: z.number(),
  brnch: z.number(),
  status: z.string(),
  route: z.enum(['DO', 'PMT']),
  customerCode: zN,
  customerName: zN,
  dcType: zN,
  destArea: zN,
  packingType: z.string(),
  vehicleNo: z.string(),
  driver: z.object({ cnic: zN, name: zN, mobile: zN }),
  transpCode: zN,
  transpName: zN,
  biltyNo: zN,
  dcYear: zNum,
  dcNo: zN,
  plannedBags: zNum,
  plannedKg: zNum,
  tareKg: zNum,
  tareOn: z.date().nullable(),
  grossKg: zNum,
  grossOn: z.date().nullable(),
  netKg: zNum,
  varianceKg: zNum,
  variancePct: zN,
  varianceStatus: zN,
  gateInOn: z.date(),
  gateInBy: z.string(),
  exitOn: z.date().nullable(),
  exitBy: zN,
  clientId: zN,
  rowVer: z.number(),
});
const zGatePassFull = zGatePass.extend({
  lines: z.array(
    z.object({
      srNo: z.number(),
      doType: z.string(),
      doNo: z.string(),
      ocNo: zN,
      plannedBags: zNum,
      plannedTon: z.string(),
      allocNetKg: zNum,
      status: z.string(),
      invoiceId: zNum,
    }),
  ),
  replay: z.boolean().optional(),
});

const zInvoiceBrief = z.object({
  invoiceId: z.number(),
  invoiceNo: z.string(),
  doNo: z.string().nullable(),
  qtyTon: z.string(),
  ratePerTon: z.string(),
  saleProceeds: z.string(),
  salesTax: z.string(),
  valueExcl: z.string().optional(),
  fed: z.string(),
  wht: z.string(),
  totalCollectable: z.string(),
});
const zInvoiceRow = zInvoiceBrief.extend({
  invoiceDate: z.string(),
  status: z.string(),
  fbrInvoiceNo: z.string().nullable(),
});
const zInvoiceProblem = z
  .object({ code: z.string(), detail: z.string(), ruleId: z.string().nullable() })
  .nullable();

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

  const actor = (request) => ({
    usrid: request.session.usrid,
    now: app.clock.now(),
    audit: request.ctx(),
  });

  app.post(
    '/plant/gate-passes',
    {
      config: { permission: P.gate.in, idempotency: 'required' },
      schema: {
        tags,
        summary:
          'Gate-in (BR-GATE-01…06): gate pass + DC issued with planned quantities; DO route (permit route pending)',
        body: zGateIn,
        response: { 200: zGatePassFull, 201: zGatePassFull },
      },
    },
    async (request, reply) => {
      const res = await app.db.withTx(
        (tx) => gate.gateIn(tx, actor(request), request.session.brnch, request.body),
        request.txOpts('plant.gate-in'),
      );
      return reply.status(res.replay ? 200 : 201).send(res);
    },
  );

  app.get(
    '/plant/gate-passes/:gpId',
    {
      config: { permission: P.gate.view },
      schema: {
        tags,
        summary: 'Gate pass with its DC lines, weights and variance',
        params: z.object({ gpId: z.coerce.number().int().positive() }),
        response: { 200: zGatePassFull.extend({ invoices: z.array(zInvoiceRow) }) },
      },
    },
    async (request) => {
      const gp = await app.db.read(
        async (tx) => ({
          ...(await gate.getGatePass(tx, request.params.gpId)),
          invoices: await invoice.invoicesOf(tx, request.params.gpId),
        }),
        request.txOpts('plant.gate-pass'),
      );
      if (!(await request.authz.permissions(gp.brnch)).has(P.gate.view))
        throw Errors.notFound(`Gate pass ${gp.gpId}`); // other branch: as if it did not exist
      return gp;
    },
  );

  app.get(
    '/plant/board',
    {
      config: { permission: P.gate.view },
      schema: {
        tags,
        summary: 'Open gate passes of my branch with minutes since gate-in',
        response: { 200: z.object({ items: z.array(zGatePass.extend({ waitMin: z.number() })) }) },
      },
    },
    async (request) => ({
      items: await app.db.read(
        (tx) => gate.board(tx, request.session.brnch, app.clock.now()),
        request.txOpts('plant.board'),
      ),
    }),
  );

  // ---- weighing (P3-05) ----
  const zWeighSource = z.union([
    z.object({
      deviceId: z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,39}$/),
      readingId: z.string().regex(/^[A-Za-z0-9-]{8,60}$/),
    }),
    z.object({ weightKg: z.number().int().min(1).max(200000), reason: zReason }),
  ]);
  const zGpParams = z.object({ gpId: z.coerce.number().int().positive() });
  /** gate pass of my branch, else 404; manual weights need weigh.manual (BR-WGT-02) */
  const plantCommand = (path, perm, body, summary, fn, response) =>
    app.post(
      `/plant/gate-passes/:gpId/${path}`,
      {
        config: { permission: perm, idempotency: 'required' },
        schema: { tags, summary, params: zGpParams, body, response: { 200: response } },
      },
      async (request) => {
        // agent reading: weigh.capture; weight typed by hand: weigh.manual (BR-WGT-02)
        if (request.body && ('weightKg' in request.body || 'readingId' in request.body)) {
          const perms = await request.authz.permissions(request.session.brnch);
          const need = 'weightKg' in request.body ? P.weigh.manual : P.weigh.capture;
          if (!perms.has(need))
            throw Errors.forbidden(
              need === P.weigh.manual
                ? 'You need weigh.manual to enter a weight by hand'
                : 'You need weigh.capture to take the weighbridge reading',
            );
        }
        return app.db.withTx(
          async (tx) => {
            const gp = await tx.one('SELECT BRNCH FROM GATE_PASS WHERE GP_ID = :id', {
              id: request.params.gpId,
            });
            if (!gp || Number(gp.BRNCH) !== request.session.brnch)
              throw Errors.notFound(`Gate pass ${request.params.gpId}`);
            return fn(tx, actor(request), request.params.gpId, request.body);
          },
          request.txOpts(`plant.${path}`),
        );
      },
    );
  const zWeighResult = z.object({
    gatePass: zGatePassFull,
    net: z.number(),
    variance: z.number(),
    variancePct: z.string(),
    direction: z.enum(['OVER', 'UNDER', 'EXACT']),
    varianceStatus: z.enum(['OK', 'BLOCKED']),
    toleranceKg: z.number(),
    invoices: z.array(zInvoiceBrief),
    invoiceProblem: zInvoiceProblem,
  });
  plantCommand(
    'tare',
    [P.weigh.capture, P.weigh.manual],
    zWeighSource,
    "Tare (BR-WGT-01/02/03): { deviceId, readingId } from the agent, or { weightKg, reason } with weigh.manual; warns when far from the vehicle's last tare",
    (tx, a, id, b) => weighing.captureTare(tx, a, id, b),
    z.object({ gatePass: zGatePassFull, warnings: z.array(z.string()) }),
  );
  plantCommand(
    'gross',
    [P.weigh.capture, P.weigh.manual],
    zWeighSource,
    'Gross (BR-WGT-03…06): net, variance vs planned, OK or VARIANCE_BLOCKED; net split over the DC lines',
    (tx, a, id, b) => weighing.captureGross(tx, a, id, b),
    zWeighResult,
  );
  plantCommand(
    'reweigh',
    [P.weigh.capture, P.weigh.manual],
    zWeighSource,
    'New gross while the variance blocks the truck (BR-WGT-05); earlier readings stay',
    (tx, a, id, b) => weighing.captureGross(tx, a, id, b, { reweigh: true }),
    zWeighResult,
  );
  plantCommand(
    'request-weight-override',
    P.weigh.override,
    z.object({ reason: zReason }),
    'Supervisor override of a blocked variance → approval WEIGHT_OVERRIDE (BR-WGT-05)',
    (tx, a, id, b) => weighing.requestWeightOverride(tx, a, id, b.reason),
    z.object({
      gatePass: zGatePassFull,
      requestId: z.number().nullable(),
      invoices: z.array(zInvoiceBrief),
      invoiceProblem: zInvoiceProblem,
    }),
  );
  plantCommand(
    'finalise',
    [P.weigh.capture, P.dc.update],
    z.object({}),
    'Finalise the invoices again after fixing what was missing (BR-INV-01); normally automatic after the gross',
    async (tx, a, id) => ({
      invoices: await invoice.finalise(tx, a, id),
      gatePass: await gate.getGatePass(tx, id),
    }),
    z.object({ invoices: z.array(zInvoiceBrief), gatePass: zGatePassFull }),
  );
}
