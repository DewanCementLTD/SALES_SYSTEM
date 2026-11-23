// /api/v1/invoices (API_SPEC §12; TASKS P3-06/07): list, detail with the full tax breakdown and FBR
// state, FBR attempts, FBR retry. Invoices are made by the weighing (modules/plant/invoice.js).
import { INVOICE_STATUS, P, zBrnch, zIsoDate, zPageQuery } from '@dcl/shared';
import { z } from 'zod';
import { branchFilter, resolveListBranches } from '../../lib/branch-scope.js';
import { Errors } from '../../lib/errors.js';
import { paginate } from '../../lib/oracle/paginate.js';
import * as fbr from '../fbr/service.js';

const n2 = (v) => (v === null || v === undefined ? null : Number(v).toFixed(2));
const COLS = `i.INVOICE_ID, i.BRNCH, i.INVOICE_YEAR, i.INVOICE_NO, i.INVOICE_DATE, i.STATUS, i.GP_ID, i.DC_TYPE,
  i.DC_NO, TO_CHAR(i.DO_NO) AS DO_NO, TO_CHAR(i.OC_NO) AS OC_NO, i.CUSTOMER_CODE, i.BUYER_NAME, i.PRODUCT_CODE,
  i.PRICE_CODE, i.QTY_BASIS, i.QTY_TON, i.BAGS, i.RATE_INCL, i.RETAIL_VALUE_EXCL, i.FED_PER_TON, i.FED_AMT,
  i.RETAIL_VALUE, i.ST_PCT, i.ST_AMT, i.MARKET_VALUE, i.SALE_PROCEEDS, i.VALUE_EXCL, i.RATE_EXCL, i.WHT_PCT,
  i.WHT_AMT, i.TOTAL_COLLECTABLE, i.BUYER_NTN, i.BUYER_STRN, i.BUYER_FILER, i.VEHICLE_NO, i.FBR_INVOICE_NO,
  i.FBR_SUBMITTED_ON, i.FBR_ACCEPTED_ON, i.CREATED_BY, i.CREATED_ON,
  (SELECT MAX(s.ERROR_MSG) KEEP (DENSE_RANK LAST ORDER BY s.ATTEMPT_NO) FROM FBR_SUBMISSION s
    WHERE s.INVOICE_ID = i.INVOICE_ID) AS FBR_ERROR`;

function mapInvoice(r) {
  return {
    invoiceId: Number(r.INVOICE_ID),
    brnch: Number(r.BRNCH),
    year: Number(r.INVOICE_YEAR),
    invoiceNo: String(r.INVOICE_NO),
    invoiceDate: new Date(r.INVOICE_DATE).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }),
    status: r.STATUS,
    gpId: Number(r.GP_ID),
    dcType: r.DC_TYPE ?? null,
    dcNo: r.DC_NO === null ? null : String(r.DC_NO),
    doNo: r.DO_NO ?? null,
    ocNo: r.OC_NO ?? null,
    customerCode: r.CUSTOMER_CODE,
    customerName: r.BUYER_NAME ?? null,
    productCode: r.PRODUCT_CODE,
    priceCode: r.PRICE_CODE ?? null,
    qtyBasis: r.QTY_BASIS,
    qtyTon: Number(r.QTY_TON).toFixed(3),
    bags: r.BAGS === null ? null : Number(r.BAGS),
    ratePerTon: n2(r.RATE_INCL),
    retailExcl: n2(r.RETAIL_VALUE_EXCL),
    fedPerTon: n2(r.FED_PER_TON),
    fed: n2(r.FED_AMT),
    retailValue: n2(r.RETAIL_VALUE),
    stPct: Number(r.ST_PCT).toFixed(2),
    salesTax: n2(r.ST_AMT),
    taxInclusiveValue: n2(r.MARKET_VALUE),
    saleProceeds: n2(r.SALE_PROCEEDS),
    valueExcl: n2(r.VALUE_EXCL),
    rateExclPerTon: n2(r.RATE_EXCL),
    whtPct: Number(r.WHT_PCT).toFixed(3),
    wht: n2(r.WHT_AMT),
    totalCollectable: n2(r.TOTAL_COLLECTABLE),
    buyerNtn: r.BUYER_NTN ?? null,
    buyerStrn: r.BUYER_STRN ?? null,
    buyerFiler: r.BUYER_FILER ?? null,
    vehicleNo: r.VEHICLE_NO ?? null,
    fbrInvoiceNo: r.FBR_INVOICE_NO ?? null,
    fbrSubmittedOn: r.FBR_SUBMITTED_ON ?? null,
    fbrAcceptedOn: r.FBR_ACCEPTED_ON ?? null,
    fbrError: r.STATUS === 'FBR_REJECTED' ? (r.FBR_ERROR ?? null) : null,
    createdBy: r.CREATED_BY,
    createdOn: r.CREATED_ON,
  };
}

const zN = z.string().nullable();
const zInvoice = z.object({
  invoiceId: z.number(),
  brnch: z.number(),
  year: z.number(),
  invoiceNo: z.string(),
  invoiceDate: z.string(),
  status: z.string(),
  gpId: z.number(),
  dcType: zN,
  dcNo: zN,
  doNo: zN,
  ocNo: zN,
  customerCode: z.string(),
  customerName: zN,
  productCode: z.string(),
  priceCode: zN,
  qtyBasis: z.string(),
  qtyTon: z.string(),
  bags: z.number().nullable(),
  ratePerTon: zN,
  retailExcl: zN,
  fedPerTon: zN,
  fed: zN,
  retailValue: zN,
  stPct: z.string(),
  salesTax: zN,
  taxInclusiveValue: zN,
  saleProceeds: zN,
  valueExcl: zN,
  rateExclPerTon: zN,
  whtPct: z.string(),
  wht: zN,
  totalCollectable: zN,
  buyerNtn: zN,
  buyerStrn: zN,
  buyerFiler: zN,
  vehicleNo: zN,
  fbrInvoiceNo: zN,
  fbrSubmittedOn: z.date().nullable(),
  fbrAcceptedOn: z.date().nullable(),
  fbrError: zN,
  createdBy: z.string(),
  createdOn: z.date(),
});
const zKey = z.object({
  brnch: zBrnch,
  year: z.coerce.number().int().min(2000).max(2100),
  invoiceNo: z.string().regex(/^\d{1,10}$/),
});

/** @param {import('fastify').FastifyInstance} app */
export default async function invoiceRoutes(app) {
  const tags = ['invoices'];
  const byKey = async (tx, { brnch, year, invoiceNo }) => {
    const r = await tx.one(
      `SELECT ${COLS} FROM SALES_INVOICE i WHERE i.BRNCH = :b AND i.INVOICE_YEAR = :y AND i.INVOICE_NO = :n`,
      { b: brnch, y: year, n: invoiceNo },
    );
    if (!r) throw Errors.notFound(`Invoice ${invoiceNo}`);
    return mapInvoice(r);
  };

  app.get(
    '/invoices',
    {
      config: { permission: P.invoice.view },
      schema: {
        tags,
        summary: 'Invoices of my branches; fbr=pending|rejected|accepted filters the FBR state',
        querystring: zPageQuery.extend({
          brnch: z.union([z.literal('all'), z.coerce.number().int()]).optional(),
          status: z
            .enum(/** @type {[string, ...string[]]} */ (Object.keys(INVOICE_STATUS)))
            .optional(),
          customer: z.string().max(11).optional(),
          from: zIsoDate.optional(),
          to: zIsoDate.optional(),
        }),
        response: {
          200: z.object({
            items: z.array(zInvoice),
            page: z.number(),
            pageSize: z.number(),
            total: z.number(),
          }),
        },
      },
    },
    async (request) => {
      const q = request.query;
      const branches = resolveListBranches(
        {
          brnch: request.session.brnch,
          allowedBranches: await request.authz.branchesWith(P.invoice.view),
        },
        q.brnch,
      );
      return app.db.read(async (tx) => {
        const bf = branchFilter('i.BRNCH', branches);
        const where = [bf.sql];
        const binds = { ...bf.binds };
        if (q.status) {
          where.push('i.STATUS = :st');
          binds.st = q.status;
        }
        if (q.customer) {
          where.push('i.CUSTOMER_CODE = :cu');
          binds.cu = q.customer;
        }
        if (q.from) {
          where.push('i.INVOICE_DATE >= :df');
          binds.df = new Date(`${q.from}T00:00:00+05:00`);
        }
        if (q.to) {
          where.push('i.INVOICE_DATE < :dt + 1');
          binds.dt = new Date(`${q.to}T00:00:00+05:00`);
        }
        const page = await paginate(tx, {
          sql: `SELECT ${COLS} FROM SALES_INVOICE i WHERE ${where.join(' AND ')}
                ORDER BY i.INVOICE_DATE DESC, i.INVOICE_NO DESC, i.BRNCH`,
          binds,
          page: q.page,
          pageSize: q.pageSize,
        });
        return { ...page, items: page.items.map(mapInvoice) };
      }, request.txOpts('invoices.list'));
    },
  );

  app.get(
    '/invoices/:brnch/:year/:invoiceNo',
    {
      config: { permission: P.invoice.view },
      schema: {
        tags,
        summary: 'Invoice with the tax breakdown and FBR state',
        params: zKey,
        response: { 200: zInvoice },
      },
    },
    async (request) =>
      app.db.read((tx) => byKey(tx, request.params), request.txOpts('invoices.get')),
  );

  app.get(
    '/invoices/:brnch/:year/:invoiceNo/fbr-submissions',
    {
      config: { permission: P.invoice.fbr_view },
      schema: { tags, summary: 'FBR attempts with request and answer (BR-FBR-03)', params: zKey },
    },
    async (request) =>
      app.db.read(async (tx) => {
        const inv = await byKey(tx, request.params);
        return { items: await fbr.submissions(tx, inv.invoiceId) };
      }, request.txOpts('invoices.fbr')),
  );

  app.post(
    '/invoices/:brnch/:year/:invoiceNo/fbr-retry',
    {
      config: { permission: P.invoice.fbr_retry },
      schema: {
        tags,
        summary:
          "Send to FBR again (after a correction, BR-FBR-04); confirmNotAccepted when the last attempt's outcome is unknown (BR-FBR-05)",
        params: zKey,
        body: z.object({ confirmNotAccepted: z.boolean().optional() }),
        response: { 200: z.object({ outboxId: z.number() }) },
      },
    },
    async (request) =>
      app.db.withTx(async (tx) => {
        const inv = await byKey(tx, request.params);
        return fbr.retry(
          tx,
          { now: app.clock.now(), audit: request.ctx() },
          inv.invoiceId,
          request.body,
        );
      }, request.txOpts('invoices.fbr-retry')),
  );
}
