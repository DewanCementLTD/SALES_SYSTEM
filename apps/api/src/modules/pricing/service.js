// Trade prices for DO clients (BR-PRC-01..06, TASKS P1-06). A price is for customer + product + city
// (TRADE_PRICE, GEO_CODE since migration 008), effective from EF_DATE until a later approved row of
// the same key. A change is a new row with the next price-code version; nothing is edited.
import {
  businessDate,
  dec,
  mrpViolation,
  nextPriceCode,
  parseGeoCode,
  priceBreakdown,
} from '@dcl/shared';
import { branchFilter } from '../../lib/branch-scope.js';
import { Errors } from '../../lib/errors.js';
import { paginate } from '../../lib/oracle/paginate.js';
import { onApproved, onRejected, requestApproval } from '../approvals/service.js';
import { recordAudit } from '../audit/service.js';

/** @typedef {import('../../lib/oracle/db.js').Tx} Tx */

const toDate = (iso) => new Date(`${iso}T00:00:00+05:00`);
const money = (v) => (v === null || v === undefined ? null : dec(v).toFixed(2));
/** Rows that count (legacy rows have no DOC_STATUS; ACTIVE = 'N' = withdrawn price). */
const LIVE = `NVL(t.DOC_STATUS, 'APPROVED') = 'APPROVED' AND NVL(t.ACTIVE, 'Y') = 'Y'`;
const COLS = `t.BRNCH, t.AREA_CODE, t.AREA_DESC, t.PRODUCT_CODE, t.CUSTOMER_CODE, t.GEO_CODE, t.EF_DATE, t.INVOICE_PRICE,
  t.TRADE_DISC, t.RETAIL_PRICE, t.SALES_TAX_PERCENT, t.SALES_TAX_AMT, t.CED, t.COMPANY_PRICE, t.TARGET, t.ACTIVE,
  t.DOC_STATUS, t.CREATED_BY, t.ENTER_BY, t.APPROVED_BY, t.APPROVED_ON, c.CUSTOMER_NAME`;
const JOIN = `LEFT JOIN CUSTOMER_INFO c ON c.BRNCH = t.BRNCH AND c.CUSTOMER_CODE = t.CUSTOMER_CODE`;

function mapTp(r) {
  return {
    brnch: Number(r.BRNCH),
    priceCode: r.AREA_CODE,
    description: r.AREA_DESC,
    customerCode: r.CUSTOMER_CODE ?? null,
    customerName: r.CUSTOMER_NAME ?? null,
    productCode: r.PRODUCT_CODE ?? null,
    geoCode: r.GEO_CODE ?? null,
    efDate: r.EF_DATE ? businessDate(r.EF_DATE) : null,
    invoicePrice: money(r.INVOICE_PRICE ?? r.TRADE_DISC),
    retailPrice: money(r.RETAIL_PRICE),
    salesTaxPer: money(r.SALES_TAX_PERCENT),
    salesTaxAmt: money(r.SALES_TAX_AMT),
    fedPerTon: money(r.CED),
    companyPrice: money(r.COMPANY_PRICE),
    target: r.TARGET === null || r.TARGET === undefined ? null : String(r.TARGET),
    active: r.ACTIVE !== 'N',
    status: r.DOC_STATUS ?? 'APPROVED',
    createdBy: r.CREATED_BY ?? r.ENTER_BY ?? null,
    approvedBy: r.APPROVED_BY ?? null,
  };
}

/** BR-TAX-10 effective product period with the price breakdown. */
export async function effectivePeriod(tx, brnch, productCode, date) {
  const r = await tx.one(
    `SELECT * FROM PRODUCT_DESC_T WHERE BRNCH = :b AND PRODUCT_CODE = :p AND DATE_FROM <= :d ORDER BY PERIOD# DESC`,
    { b: brnch, p: productCode, d: toDate(date) },
  );
  if (!r) return null;
  return {
    period: Number(r['PERIOD#']),
    productName: r.PRODUCT_NAME,
    dateFrom: businessDate(r.DATE_FROM),
    ...priceBreakdown({
      mrp: r.CODE === null ? null : String(r.CODE),
      retailPrice: r.R_PRICE === null ? null : String(r.R_PRICE),
      salesTaxPer: r.P_SALES_TAX_PER === null ? null : String(r.P_SALES_TAX_PER),
      salesTaxAmt: r.P_SALES_TAX === null ? null : String(r.P_SALES_TAX),
      fedPerTon: r.CED === null ? '0' : String(r.CED),
    }),
  };
}

const keyWhere = `t.BRNCH = :b AND t.CUSTOMER_CODE = :c AND t.PRODUCT_CODE = :p AND t.GEO_CODE = :g`;

/** BR-PRC-02: the trade price that applies on a date (latest approved start ≤ date). */
export async function effectiveTradePrice(tx, { brnch, customerCode, productCode, geoCode, date }) {
  const r = await tx.one(
    `SELECT ${COLS} FROM TRADE_PRICE t ${JOIN} WHERE ${keyWhere} AND ${LIVE} AND t.EF_DATE <= :d
      ORDER BY t.EF_DATE DESC, t.CREATED_ON DESC NULLS LAST, t.AREA_CODE DESC`,
    { b: brnch, c: customerCode, p: productCode, g: geoCode, d: toDate(date) },
  );
  return r ? mapTp(r) : null;
}

/** Quote used by the draft OC (P2-02): trade price + the product's tax/price breakdown. */
export async function quote(tx, q) {
  const period = await effectivePeriod(tx, q.brnch, q.productCode, q.date);
  const tradePrice = await effectiveTradePrice(tx, q);
  return { date: q.date, tradePrice, period };
}

/** All versions of one key, newest first (history timeline; never edited). */
export async function history(tx, { brnch, customerCode, productCode, geoCode }) {
  const rows = await tx.many(
    `SELECT ${COLS} FROM TRADE_PRICE t ${JOIN} WHERE ${keyWhere}
      ORDER BY t.EF_DATE DESC NULLS LAST, t.AREA_CODE DESC`,
    { b: brnch, c: customerCode, p: productCode, g: geoCode },
  );
  return rows.map(mapTp);
}

/** List (filters: customer, product, city, status), newest first. */
export async function listTradePrices(tx, o) {
  const bf = branchFilter('t.BRNCH', o.branches);
  const where = [bf.sql];
  const binds = { ...bf.binds };
  if (o.customerCode) {
    where.push('t.CUSTOMER_CODE = :c');
    binds.c = o.customerCode;
  }
  if (o.productCode) {
    where.push('t.PRODUCT_CODE = :p');
    binds.p = o.productCode;
  }
  if (o.geoCode) {
    where.push('t.GEO_CODE = :g');
    binds.g = o.geoCode;
  }
  if (o.status) {
    where.push(`NVL(t.DOC_STATUS, 'APPROVED') = :st`);
    binds.st = o.status;
  }
  if (o.q) {
    where.push(
      `(t.AREA_CODE LIKE :q ESCAPE '\\' OR UPPER(c.CUSTOMER_NAME) LIKE :q ESCAPE '\\' OR t.CUSTOMER_CODE LIKE :q ESCAPE '\\')`,
    );
    binds.q = `%${o.q.toUpperCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  }
  const page = await paginate(tx, {
    sql: `SELECT ${COLS} FROM TRADE_PRICE t ${JOIN} WHERE ${where.join(' AND ')}
          ORDER BY t.EF_DATE DESC NULLS LAST, t.BRNCH, t.AREA_CODE`,
    binds,
    page: o.page,
    pageSize: o.pageSize,
  });
  return { ...page, items: page.items.map(mapTp) };
}

export async function setStatus(tx, brnch, priceCode, status, { usrid, now }) {
  await tx.exec(
    `UPDATE TRADE_PRICE SET DOC_STATUS = :st, ROW_VER = ROW_VER + 1
       ${status === 'APPROVED' ? ', APPROVED_BY = :usr, APPROVED_ON = :now' : ', UPDATED_BY = :usr, UPDATED_ON = :now'}
     WHERE BRNCH = :b AND AREA_CODE = :code AND DOC_STATUS = 'PENDING_APPROVAL'`,
    { st: status, usr: usrid, now, b: brnch, code: priceCode },
  );
}

/**
 * New trade price (pricing.create): checks BR-PRC-01 (later than the latest version, one pending
 * per key) and BR-PRC-03 (not above MRP); values from the effective product period.
 * @param {Tx} tx @param {{ usrid: string, audit: object, now: Date }} actor @param {number} brnch
 * @param {import('zod').infer<typeof import('@dcl/shared').zTradePriceRequest>} body
 * @param {{ approval?: boolean }} [opts] approval false = insert only (the Excel import asks once)
 */
export async function requestTradePrice(tx, actor, brnch, body, { approval = true } = {}) {
  const cust = await tx.one(
    `SELECT CUSTOMER_NAME, NVL(DOC_STATUS, CASE WHEN CLOSED = 'Y' THEN 'CLOSED' ELSE 'APPROVED' END) AS ST
       FROM CUSTOMER_INFO WHERE BRNCH = :b AND CUSTOMER_CODE = :c FOR UPDATE`,
    { b: brnch, c: body.customerCode },
  );
  if (!cust)
    throw Errors.validation(`Customer ${body.customerCode} does not exist in branch ${brnch}`);
  if (cust.ST === 'CLOSED') throw Errors.invalidState('Customer account is closed');
  const g = parseGeoCode(body.geoCode);
  const node = g
    ? await tx.one(
        'SELECT CITY_NAME, AREA_NAME, ACTIVE FROM GEO_HIERARCHY WHERE BRNCH = :b AND GEO_CODE = :g',
        { b: brnch, g: body.geoCode },
      )
    : null;
  if (!node || g.level < 4) {
    throw Errors.validation('Choose the city the price is for', [
      { path: 'body.geoCode', message: 'City required' },
    ]);
  }
  const period = await effectivePeriod(tx, brnch, body.productCode, body.efDate);
  if (!period) {
    throw Errors.rule('BR-TAX-10', `Product ${body.productCode} has no period on ${body.efDate}`);
  }
  const over = mrpViolation(body.invoicePrice, period.mrp);
  if (over) throw Errors.rule(over.ruleId, over.detail, over.data);

  const key = { b: brnch, c: body.customerCode, p: body.productCode, g: body.geoCode };
  const pending = await tx.one(
    `SELECT t.AREA_CODE FROM TRADE_PRICE t WHERE ${keyWhere} AND t.DOC_STATUS = 'PENDING_APPROVAL'`,
    key,
  );
  if (pending) {
    throw Errors.duplicate(
      `Price ${pending.AREA_CODE} for this customer, product and city is waiting for approval`,
    );
  }
  const latest = await tx.one(
    `SELECT t.AREA_CODE, t.EF_DATE FROM TRADE_PRICE t WHERE ${keyWhere} AND ${LIVE}
      ORDER BY t.EF_DATE DESC NULLS LAST, t.AREA_CODE DESC`,
    key,
  );
  if (latest?.EF_DATE && businessDate(latest.EF_DATE) >= body.efDate) {
    throw Errors.rule(
      'BR-PRC-01',
      `The new price must start after the current one (${latest.AREA_CODE} from ${businessDate(latest.EF_DATE)}); history is never changed`,
    );
  }
  let code;
  try {
    code = nextPriceCode(latest?.AREA_CODE ?? null, body.priceCodeBase);
  } catch (e) {
    throw Errors.validation(/** @type {Error} */ (e).message, [
      { path: 'body.priceCodeBase', message: 'Enter letters for the new price code' },
    ]);
  }
  for (let i = 0; i < 20; i += 1) {
    const taken = await tx.one(
      'SELECT 1 AS X FROM TRADE_PRICE WHERE BRNCH = :b AND AREA_CODE = :code',
      {
        b: brnch,
        code,
      },
    );
    if (!taken) break;
    code = nextPriceCode(code);
  }
  if (code.length > 10) throw Errors.validation(`Price code ${code} is longer than 10 characters`);

  const cityNum = g.city && /^\d{1,9}$/.test(g.city) ? Number(g.city) : null;
  await tx.exec(
    `INSERT INTO TRADE_PRICE (AREA_CODE, AREA_DESC, PRODUCT_CODE, TRADE_DISC, ENTER_BY, ENTER_DATE, INVOICE_PRICE,
        COMPANY_PRICE, ACTIVE, SALES_TAX_PERCENT, SALES_TAX_AMT, RETAIL_PRICE, CED, AREA, CITY_CD, CUSTOMER_CODE,
        EF_DATE, TARGET, COMPC, BRNCH, DOC_STATUS, ROW_VER, CREATED_BY, CREATED_ON, GEO_CODE)
     VALUES (:code, :descr, :p, :price, :enter, :now, :price, :company, 'Y', :stp, :st, :retail, :fed, :area, :city, :c,
        :ef, :target, 1, :b, 'PENDING_APPROVAL', 1, :usr, :now, :g)`,
    {
      code,
      descr: String(node.CITY_NAME ?? node.AREA_NAME ?? body.geoCode).slice(0, 30),
      p: body.productCode,
      price: dec(body.invoicePrice).toString(),
      enter: actor.usrid.slice(0, 10),
      now: actor.now,
      company: period.companyPrice,
      stp: period.salesTaxPer,
      st: period.salesTaxAmt,
      retail: period.retailPrice,
      fed: period.fedPerTon,
      area: brnch === 2 ? cityNum : null,
      city: brnch === 1 ? cityNum : null,
      c: body.customerCode,
      ef: toDate(body.efDate),
      target: body.target ?? null,
      b: brnch,
      usr: actor.usrid,
      g: body.geoCode,
    },
  );
  await recordAudit(tx, actor.audit, {
    entity: 'TRADE_PRICE',
    key: `${brnch}|${code}`,
    action: 'CREATE',
    brnch,
    newValues: { ...body, priceCode: code, period: period.period },
  });
  if (!approval) return { priceCode: code, tradePrice: null, requestId: null };
  const r = await requestApproval(
    tx,
    { ...actor.audit, now: actor.now },
    {
      docType: 'RATE_CHANGE',
      brnch,
      docKey: `TRADE_PRICE|${brnch}|${code}`,
      action: 'TRADE_PRICE_SET',
      snapshot: {
        ...body,
        priceCode: code,
        customerName: cust.CUSTOMER_NAME,
        previous: latest?.AREA_CODE ?? null,
      },
      reason: `Trade price ${code}: ${body.customerCode} ${body.productCode} ${body.invoicePrice}/t from ${body.efDate}`,
    },
  );
  if (!r.required) await setStatus(tx, brnch, code, 'APPROVED', actor);
  const row = await tx.one(
    `SELECT ${COLS} FROM TRADE_PRICE t ${JOIN} WHERE t.BRNCH = :b AND t.AREA_CODE = :code`,
    {
      b: brnch,
      code,
    },
  );
  return { tradePrice: mapTp(row), requestId: r.required ? r.requestId : null };
}

const keyOf = (req) => {
  const [, b, code] = req.docKey.split('|');
  return { brnch: Number(b), code };
};
onApproved('TRADE_PRICE_SET', async (tx, req, ctx) => {
  const { brnch, code } = keyOf(req);
  await setStatus(tx, brnch, code, 'APPROVED', ctx);
});
onRejected('TRADE_PRICE_SET', async (tx, req, ctx) => {
  const { brnch, code } = keyOf(req);
  await setStatus(tx, brnch, code, 'REJECTED', ctx);
});
