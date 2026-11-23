// /api/v1/pricing/* — trade prices and quote (API_SPEC §4 Pricing, TASKS P1-06).
// Decisions on new prices go through Approvals (rule RATE_CHANGE, action TRADE_PRICE_SET).
import {
  P,
  zIsoDate,
  zPageQuery,
  zRateLinePatch,
  zRateSheetCreate,
  zSetMrp,
  zTradePriceRequest,
} from '@dcl/shared';
import { z } from 'zod';
import { resolveListBranches } from '../../lib/branch-scope.js';
import { Errors } from '../../lib/errors.js';
import * as imp from './import.js';
import * as rs from './rate-sheets.js';
import * as svc from './service.js';

const zM = z.string().nullable();
const zTp = z.object({
  brnch: z.number(),
  priceCode: z.string(),
  description: z.string(),
  customerCode: zM,
  customerName: zM,
  productCode: zM,
  geoCode: zM,
  geoName: zM,
  efDate: zM,
  invoicePrice: zM,
  retailPrice: zM,
  salesTaxPer: zM,
  salesTaxAmt: zM,
  fedPerTon: zM,
  companyPrice: zM,
  target: zM,
  active: z.boolean(),
  status: z.string(),
  createdBy: zM,
  approvedBy: zM,
});
const zPeriod = z
  .object({
    period: z.number(),
    productName: z.string(),
    dateFrom: z.string(),
    mrp: zM,
    retailPrice: zM,
    salesTaxPer: zM,
    salesTaxAmt: z.string(),
    fedPerTon: z.string(),
    companyPrice: zM,
  })
  .nullable();
const zKey = z.object({
  customer: z.string().trim().min(1).max(11),
  product: z.string().trim().toUpperCase().min(1).max(4),
  geoCode: z.string().trim().max(50),
});

/** @param {import('fastify').FastifyInstance} app */
export default async function pricingRoutes(app) {
  const tags = ['pricing'];
  const today = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(app.clock.now());

  app.get(
    '/pricing/trade-prices',
    {
      config: { permission: P.pricing.view },
      schema: {
        tags,
        summary: 'Trade prices (all versions), newest first',
        querystring: zPageQuery.extend({
          brnch: z.union([z.literal('all'), z.coerce.number().int()]).optional(),
          customer: z.string().max(11).optional(),
          product: z.string().max(4).optional(),
          geoCode: z.string().max(50).optional(),
          status: z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED']).optional(),
        }),
        response: {
          200: z.object({
            items: z.array(zTp),
            page: z.number(),
            pageSize: z.number(),
            total: z.number(),
          }),
        },
      },
    },
    async (request) => {
      const { brnch, customer, product, ...rest } = request.query;
      const branches = resolveListBranches(
        {
          brnch: request.session.brnch,
          allowedBranches: await request.authz.branchesWith(P.pricing.view),
        },
        brnch,
      );
      return app.db.read(
        (tx) =>
          svc.listTradePrices(tx, {
            branches,
            customerCode: customer,
            productCode: product?.toUpperCase(),
            ...rest,
          }),
        request.txOpts('pricing.list'),
      );
    },
  );

  app.get(
    '/pricing/trade-prices/history',
    {
      config: { permission: P.pricing.view },
      schema: {
        tags,
        summary: 'Every version of one customer + product + city (never edited, BR-PRC-01)',
        querystring: zKey,
        response: { 200: z.object({ items: z.array(zTp) }) },
      },
    },
    async (request) =>
      app.db.read(
        async (tx) => ({
          items: await svc.history(tx, {
            brnch: request.session.brnch,
            customerCode: request.query.customer,
            productCode: request.query.product,
            geoCode: request.query.geoCode,
          }),
        }),
        request.txOpts('pricing.history'),
      ),
  );

  app.get(
    '/pricing/quote',
    {
      config: { permission: P.pricing.view },
      schema: {
        tags,
        summary:
          'Price that applies on a date: trade price + product period breakdown (BR-PRC-02, BR-TAX-10)',
        querystring: zKey.extend({ date: zIsoDate.optional() }),
        response: {
          200: z.object({ date: z.string(), tradePrice: zTp.nullable(), period: zPeriod }),
        },
      },
    },
    async (request) =>
      app.db.read(
        (tx) =>
          svc.quote(tx, {
            brnch: request.session.brnch,
            customerCode: request.query.customer,
            productCode: request.query.product,
            geoCode: request.query.geoCode,
            date: request.query.date ?? today(),
          }),
        request.txOpts('pricing.quote'),
      ),
  );

  app.post(
    '/pricing/trade-prices',
    {
      config: { permission: P.pricing.create },
      schema: {
        tags,
        summary: 'New trade price version → approval RATE_CHANGE (BR-PRC-01/03/06)',
        body: zTradePriceRequest,
        response: { 201: z.object({ tradePrice: zTp, requestId: z.number().nullable() }) },
      },
    },
    async (request, reply) => {
      const res = await app.db.withTx(
        (tx) =>
          svc.requestTradePrice(
            tx,
            { usrid: request.session.usrid, audit: request.ctx(), now: app.clock.now() },
            request.session.brnch,
            request.body,
          ),
        request.txOpts('pricing.create'),
      );
      return reply.status(201).send(res);
    },
  );

  // --- Excel import (preview → commit) ---
  const zPreviewRow = z.object({
    row: z.number(),
    customerCode: z.string(),
    productCode: z.string(),
    geoCode: z.string(),
    invoicePrice: z.string(),
    efDate: z.string(),
    target: z.string().optional(),
    ok: z.boolean(),
    priceCode: z.string().optional(),
    error: z.string().optional(),
    ruleId: z.string().nullable().optional(),
  });
  const importActor = (request) => ({
    usrid: request.session.usrid,
    audit: request.ctx(),
    now: app.clock.now(),
  });

  app.post(
    '/pricing/trade-prices/import',
    {
      config: { permission: P.pricing.import },
      schema: {
        tags,
        summary: `Upload .xlsx (columns ${imp.IMPORT_COLUMNS.join(', ')}) → preview; importId only when every row is valid`,
        consumes: ['multipart/form-data'],
        response: {
          200: z.object({
            importId: z.string().nullable(),
            total: z.number(),
            valid: z.number(),
            rows: z.array(zPreviewRow),
          }),
        },
      },
    },
    async (request) => {
      const file = await request.file();
      if (!file) throw Errors.validation('Attach the .xlsx file');
      const rows = await imp.parseWorkbook(await file.toBuffer());
      return app.db.read(
        (tx) =>
          imp.preview(
            tx,
            importActor(request),
            request.session.brnch,
            rows,
            app.clock.now().getTime(),
          ),
        request.txOpts('pricing.import.preview'),
      );
    },
  );

  app.post(
    '/pricing/trade-prices/import/:importId/commit',
    {
      config: { permission: P.pricing.import },
      schema: {
        tags,
        summary: 'Save a clean preview: all prices + one RATE_CHANGE approval (TRADE_PRICE_IMPORT)',
        params: z.object({ importId: z.string().uuid() }),
        response: {
          201: z.object({
            created: z.number(),
            priceCodes: z.array(z.string()),
            requestId: z.number().nullable(),
          }),
        },
      },
    },
    async (request, reply) => {
      const res = await app.db.withTx(
        (tx) =>
          imp.commit(
            tx,
            importActor(request),
            request.session.brnch,
            request.params.importId,
            app.clock.now().getTime(),
          ),
        request.txOpts('pricing.import.commit'),
      );
      return reply.status(201).send(res);
    },
  );

  // --- city rate sheets (P1-07) ---
  const zMn = z.string().nullable();
  const zLine = z.object({
    lnkno: z.number(),
    productCode: z.string(),
    zone: zMn,
    territory: zMn,
    areaDoc: z.number().nullable(),
    city: zMn,
    booking: zMn,
    freight: zMn,
    netBook: zMn,
    rebate: zMn,
    exFactory: zMn,
    tax236: zMn,
    fed: zMn,
    salesTax: zMn,
    netRet: zMn,
    mrp: zMn,
  });
  const zSheet = z.object({
    brnch: z.number(),
    serno: z.number(),
    date: zMn,
    status: z.string(),
    lines: z.number().optional(),
    createdBy: zMn,
    approvedBy: zMn,
    rowVer: z.number(),
  });
  const zSheetParams = z.object({ brnch: z.coerce.number().int(), serno: z.coerce.number().int() });
  const act = (request) => ({
    usrid: request.session.usrid,
    audit: request.ctx(),
    now: app.clock.now(),
    fiscalYear: request.session.fiscalYear,
  });
  const branchesOf = async (request, requested) =>
    resolveListBranches(
      {
        brnch: request.session.brnch,
        allowedBranches: await request.authz.branchesWith(P.pricing.view),
      },
      requested,
    );

  app.get(
    '/pricing/rate-sheets',
    {
      config: { permission: P.pricing.view },
      schema: {
        tags,
        summary: 'City rate sheets, newest first (status OPEN / PENDING_APPROVAL / APPROVED)',
        querystring: zPageQuery.extend({
          brnch: z.union([z.literal('all'), z.coerce.number().int()]).optional(),
          status: z.enum(['OPEN', 'PENDING_APPROVAL', 'APPROVED']).optional(),
        }),
        response: {
          200: z.object({
            items: z.array(zSheet),
            page: z.number(),
            pageSize: z.number(),
            total: z.number(),
          }),
        },
      },
    },
    async (request) => {
      const { brnch, ...rest } = request.query;
      const branches = await branchesOf(request, brnch);
      return app.db.read(
        (tx) => rs.listSheets(tx, { branches, ...rest }),
        request.txOpts('rs.list'),
      );
    },
  );

  app.post(
    '/pricing/rate-sheets',
    {
      config: { permission: P.pricing.create },
      schema: {
        tags,
        summary: 'New sheet for a date = copy of the previous sheet (number RSH), status OPEN',
        body: zRateSheetCreate,
        response: { 201: zSheet.extend({ lines: z.array(zLine) }) },
      },
    },
    async (request, reply) => {
      const out = await app.db.withTx(
        (tx) => rs.createSheet(tx, act(request), request.session.brnch, request.body.date),
        request.txOpts('rs.create'),
      );
      return reply.status(201).send(out);
    },
  );

  app.get(
    '/pricing/rate-sheets/effective',
    {
      config: { permission: P.pricing.view },
      schema: {
        tags,
        summary: 'Permit price for product + city on a date: latest APPROVED sheet (BR-PRC-02)',
        querystring: z.object({
          product: z.string().trim().toUpperCase().max(10),
          areaDoc: z.coerce.number().int(),
          date: zIsoDate,
        }),
        response: {
          200: z.object({
            line: zLine.extend({ sheet: z.number(), sheetDate: z.string() }).nullable(),
          }),
        },
      },
    },
    async (request) =>
      app.db.read(
        async (tx) => ({
          line: await rs.effectiveLine(tx, {
            brnch: request.session.brnch,
            productCode: request.query.product,
            areaDoc: request.query.areaDoc,
            date: request.query.date,
          }),
        }),
        request.txOpts('rs.effective'),
      ),
  );

  app.get(
    '/pricing/rate-sheets/:brnch/:serno',
    {
      config: { permission: P.pricing.view },
      schema: {
        tags,
        summary: 'Sheet with all city lines (BR-PRC-05 columns)',
        params: zSheetParams,
        response: { 200: zSheet.extend({ lines: z.array(zLine) }) },
      },
    },
    async (request) =>
      app.db.read(
        (tx) => rs.getSheet(tx, request.params.brnch, request.params.serno),
        request.txOpts('rs.get'),
      ),
  );

  app.put(
    '/pricing/rate-sheets/:brnch/:serno/lines/:lnkno',
    {
      config: { permission: P.pricing.create },
      schema: {
        tags,
        summary: 'Edit a city line while the sheet is OPEN; the column chain is recalculated',
        params: zSheetParams.extend({ lnkno: z.coerce.number().int() }),
        body: zRateLinePatch,
        response: { 200: zLine },
      },
    },
    async (request) =>
      app.db.withTx(
        (tx) =>
          rs.updateLine(
            tx,
            act(request),
            request.params.brnch,
            request.params.serno,
            request.params.lnkno,
            request.body,
          ),
        request.txOpts('rs.line'),
      ),
  );

  app.post(
    '/pricing/rate-sheets/:brnch/:serno/set-mrp',
    {
      config: { permission: P.pricing.create },
      schema: {
        tags,
        summary: 'Set the MRP on every line of one product (sheet OPEN)',
        params: zSheetParams,
        body: zSetMrp,
        response: { 200: z.object({ updated: z.number() }) },
      },
    },
    async (request) =>
      app.db.withTx(
        (tx) =>
          rs.setMrp(
            tx,
            act(request),
            request.params.brnch,
            request.params.serno,
            request.body.productCode,
            request.body.mrp,
          ),
        request.txOpts('rs.mrp'),
      ),
  );

  app.post(
    '/pricing/rate-sheets/:brnch/:serno/submit',
    {
      config: { permission: P.pricing.create },
      schema: {
        tags,
        summary:
          'Send the sheet for approval (RATE_CHANGE / RATE_SHEET_APPROVE; decided in Approvals)',
        params: zSheetParams,
        response: { 200: z.object({ sheet: zSheet, requestId: z.number().nullable() }) },
      },
    },
    async (request) =>
      app.db.withTx(
        (tx) => rs.submitSheet(tx, act(request), request.params.brnch, request.params.serno),
        request.txOpts('rs.submit'),
      ),
  );

  // --- freight sheets (read) ---
  app.get(
    '/pricing/freight-sheets',
    {
      config: { permission: P.pricing.view },
      schema: {
        tags,
        summary: 'Freight sheets (ZONE_CITY_FRIEGHT_M)',
        querystring: z.object({
          brnch: z.union([z.literal('all'), z.coerce.number().int()]).optional(),
        }),
        response: { 200: z.object({ items: z.array(z.record(z.string(), z.unknown())) }) },
      },
    },
    async (request) => {
      const branches = await branchesOf(request, request.query.brnch);
      return app.db.read(
        async (tx) => ({ items: await rs.listFreightSheets(tx, branches) }),
        request.txOpts('freight.list'),
      );
    },
  );

  app.get(
    '/pricing/freight-sheets/:brnch/:serno',
    {
      config: { permission: P.pricing.view },
      schema: {
        tags,
        summary: 'Freight per city of one sheet',
        params: zSheetParams,
        response: { 200: z.object({ items: z.array(z.record(z.string(), z.unknown())) }) },
      },
    },
    async (request) =>
      app.db.read(
        async (tx) => ({
          items: await rs.freightSheet(tx, request.params.brnch, request.params.serno),
        }),
        request.txOpts('freight.get'),
      ),
  );

  app.get(
    '/pricing/freight/last',
    {
      config: { permission: P.pricing.view },
      schema: {
        tags,
        summary: 'Last freight rate (LFR) for a city on a date',
        querystring: z.object({ areaDoc: z.coerce.number().int(), date: zIsoDate }),
        response: {
          200: z.object({
            freight: z
              .object({ sheet: z.number(), date: z.string(), freight: z.string().nullable() })
              .nullable(),
          }),
        },
      },
    },
    async (request) =>
      app.db.read(
        async (tx) => ({
          freight: await rs.lastFreight(tx, { brnch: request.session.brnch, ...request.query }),
        }),
        request.txOpts('freight.last'),
      ),
  );
}
