// FBR Digital Invoicing submission (BUSINESS_RULES BR-FBR-01…05; TASKS P3-07). Run by the worker
// for each FBR_SUBMIT outbox row:
//   1. (transaction) lock the invoice; skip when already accepted; build the payload from the stored
//      row; record the attempt as SENT before calling FBR; invoice → FBR_PENDING.
//   2. call FBR (no transaction open).
//   3. (transaction) store the answer; ACCEPTED → FBR invoice number, FBR_ACCEPTED; REJECTED →
//      FBR_REJECTED with FBR's text; timeout / 5xx → stays FBR_PENDING and the job is retried.
// BR-FBR-05 (never two FBR numbers): an attempt still marked SENT means the worker stopped while
// FBR was answering — the outcome is unknown, so it is NOT resent automatically; Finance checks the
// FBR portal and uses fbr-retry with confirmNotAccepted.
import { buildFbrPayload, readFbrResponse } from '@dcl/shared';
import { decryptSecret } from '../../lib/crypto.js';
import { Errors } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import { enqueue } from '../outbox/service.js';
import { SettingsReader } from '../settings/service.js';

const PATHS = {
  SANDBOX: '/di_data/v1/di/postinvoicedata_sb',
  PRODUCTION: '/di_data/v1/di/postinvoicedata',
};

/** A stored secret setting: encrypted (v1.…) since P3-07, plain before. */
export function openSecret(value, encKey) {
  if (!value) return '';
  return String(value).startsWith('v1.') ? decryptSecret(value, encKey) : String(value);
}

/**
 * FBR driver per branch configuration. Without a base URL outside PRODUCTION the mock driver
 * answers (development, tests); PRODUCTION without a URL or token is a configuration error.
 * @returns {{ name: string, submit: (payload: object) => Promise<{ httpStatus: number|null, body: any }> }}
 */
export function createFbrDriver({
  env,
  baseUrl,
  token,
  fetch: f = globalThis.fetch,
  timeoutMs = 20000,
}) {
  if (!baseUrl) {
    if (env === 'PRODUCTION') return null;
    let n = 0;
    return {
      name: 'mock',
      async submit(payload) {
        n += 1;
        return {
          httpStatus: 200,
          body: {
            invoiceNumber: `MOCK${payload.sellerNTNCNIC}${Date.now()}${n}`,
            validationResponse: { statusCode: '00', status: 'Valid' },
          },
        };
      },
    };
  }
  const url = `${baseUrl.replace(/\/+$/, '')}${PATHS[env] ?? PATHS.SANDBOX}`;
  return {
    name: `http ${env}`,
    async submit(payload) {
      try {
        const res = await f(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        let body = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = { raw: text.slice(0, 2000) };
        }
        return { httpStatus: res.status, body };
      } catch {
        return { httpStatus: null, body: null };
      }
    },
  };
}

const INV_SQL = `SELECT i.INVOICE_ID, i.BRNCH, i.INVOICE_NO, i.INVOICE_DATE, i.STATUS, i.QTY_TON, i.PRODUCT_CODE,
  i.HS_CODE, i.ST_PCT, i.RETAIL_VALUE, i.SALE_PROCEEDS, i.ST_AMT, i.FED_AMT, i.FURTHER_TAX_AMT, i.WHT_AMT,
  i.BUYER_NAME, i.BUYER_NTN, i.BUYER_CNIC, i.BUYER_STRN, i.BUYER_ADDRESS, i.FBR_INVOICE_NO
  FROM SALES_INVOICE i WHERE i.INVOICE_ID = :id`;
const iso = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

async function lastAttempt(tx, invoiceId) {
  return tx.one(
    `SELECT * FROM (SELECT SUB_ID, ATTEMPT_NO, RESULT FROM FBR_SUBMISSION WHERE INVOICE_ID = :id
       ORDER BY ATTEMPT_NO DESC) WHERE ROWNUM = 1`,
    { id: invoiceId },
  );
}

/**
 * Submit one invoice (worker). Returns the outcome; throws only to make BullMQ retry (timeout/5xx).
 * @param {import('../../lib/oracle/db.js').Db} db
 * @param {{ encKey: string, now: () => Date, fetch?: typeof fetch, log?: any }} deps
 */
export async function submitInvoice(db, invoiceId, deps) {
  const ctx = { usrid: 'fbr', action: 'fbr.submit' };
  const prep = await db.withTx(async (tx) => {
    const inv = await tx.one(`${INV_SQL} FOR UPDATE`, { id: invoiceId });
    if (!inv) return { skip: 'no such invoice' };
    if (['FBR_ACCEPTED', 'CANCELLED'].includes(inv.STATUS)) return { skip: inv.STATUS };
    const last = await lastAttempt(tx, invoiceId);
    if (last?.RESULT === 'SENT')
      return { skip: 'outcome of the last attempt unknown: check the FBR portal, then fbr-retry' };
    const s = new SettingsReader(tx);
    const b = Number(inv.BRNCH);
    const env = (await s.get(b, 'FBR_ENV')) || 'SANDBOX';
    const cfg = {
      ntn: await s.get(b, 'FBR_SELLER_NTN'),
      name: await s.get(b, 'FBR_SELLER_NAME'),
      province: await s.get(b, 'FBR_SELLER_PROVINCE'),
      address: await s.get(b, 'FBR_SELLER_ADDRESS'),
      saleType: await s.get(b, 'FBR_SALE_TYPE'),
      uom: await s.get(b, 'FBR_UOM'),
      hsCode: await s.get(b, 'FBR_HS_CODE'),
      scenarioId: env === 'SANDBOX' ? await s.get(b, 'FBR_SCENARIO_ID') : '',
    };
    const built = buildFbrPayload(
      {
        invoiceDate: iso(inv.INVOICE_DATE),
        qtyTon: String(inv.QTY_TON),
        productCode: inv.PRODUCT_CODE,
        hsCode: inv.HS_CODE,
        stPct: String(inv.ST_PCT),
        retailValue: String(inv.RETAIL_VALUE),
        saleProceeds: String(inv.SALE_PROCEEDS),
        salesTax: String(inv.ST_AMT),
        fed: String(inv.FED_AMT),
        furtherTax: String(inv.FURTHER_TAX_AMT ?? 0),
        wht: String(inv.WHT_AMT ?? 0),
        buyerName: inv.BUYER_NAME,
        buyerNtn: inv.BUYER_NTN,
        buyerCnic: inv.BUYER_CNIC,
        buyerStrn: inv.BUYER_STRN,
        buyerAddress: inv.BUYER_ADDRESS,
      },
      cfg,
    );
    const driver = createFbrDriver({
      env,
      baseUrl: await s.get(b, 'FBR_BASE_URL'),
      token: openSecret(await s.raw(b, 'FBR_TOKEN_ENC'), deps.encKey),
      fetch: deps.fetch,
    });
    const attemptNo = Number(last?.ATTEMPT_NO ?? 0) + 1;
    const subId = await tx.nextId('SEQ_FBR_SUBMISSION');
    const now = deps.now();
    const problem = !built.ok
      ? `Not sent: missing ${built.missing.join(', ')}`
      : !driver
        ? 'Not sent: FBR_BASE_URL is not set for PRODUCTION'
        : null;
    await tx.exec(
      `INSERT INTO FBR_SUBMISSION (SUB_ID, BRNCH, INVOICE_ID, ATTEMPT_NO, FBR_ENV, REQUEST_BODY, RESULT,
         ERROR_MSG, SUBMITTED_ON)
       VALUES (:id, :b, :inv, :n, :env, :req, :res, :err, :now)`,
      {
        id: subId,
        b,
        inv: invoiceId,
        n: attemptNo,
        env: env === 'PRODUCTION' ? 'PROD' : 'SANDBOX',
        req: JSON.stringify(built.ok ? built.payload : { missing: built.missing }),
        res: problem ? 'REJECTED' : 'SENT',
        err: problem,
        now,
      },
    );
    await tx.exec(
      `UPDATE SALES_INVOICE SET STATUS = :st, FBR_SUBMITTED_ON = :now, ROW_VER = ROW_VER + 1
        WHERE INVOICE_ID = :id`,
      { st: problem ? 'FBR_REJECTED' : 'FBR_PENDING', now, id: invoiceId },
    );
    if (problem) return { done: { result: 'REJECTED', errorMsg: problem } };
    return { subId, payload: built.payload, driver, brnch: b, invoiceNo: String(inv.INVOICE_NO) };
  }, ctx);
  if (prep.skip) return { skipped: prep.skip };
  if (prep.done) return prep.done;

  const t0 = Date.now();
  const { httpStatus, body } = await prep.driver.submit(prep.payload);
  const out = readFbrResponse(httpStatus, body);
  await db.withTx(async (tx) => {
    const now = deps.now();
    await tx.exec(
      `UPDATE FBR_SUBMISSION SET RESPONSE_BODY = :rb, HTTP_STATUS = :hs, RESULT = :r, FBR_INVOICE_NO = :fno,
         ERROR_CODE = :ec, ERROR_MSG = :em, DURATION_MS = :ms
        WHERE SUB_ID = :id`,
      {
        rb: body === null ? null : JSON.stringify(body),
        hs: httpStatus,
        r: out.result,
        fno: out.fbrInvoiceNo ?? null,
        ec: out.errorCode ?? null,
        em: out.errorMsg ?? null,
        ms: Date.now() - t0,
        id: prep.subId,
      },
    );
    if (out.result === 'ACCEPTED') {
      await tx.exec(
        `UPDATE SALES_INVOICE SET STATUS = 'FBR_ACCEPTED', FBR_INVOICE_NO = :fno, FBR_QR_DATA = :fno,
           FBR_ACCEPTED_ON = :now, ROW_VER = ROW_VER + 1 WHERE INVOICE_ID = :id`,
        { fno: out.fbrInvoiceNo, now, id: invoiceId },
      );
    } else if (!out.retry) {
      await tx.exec(
        `UPDATE SALES_INVOICE SET STATUS = 'FBR_REJECTED', ROW_VER = ROW_VER + 1 WHERE INVOICE_ID = :id`,
        { id: invoiceId },
      );
    }
    if (!out.retry)
      await recordAudit(tx, ctx, {
        entity: 'SALES_INVOICE',
        key: String(invoiceId),
        action: out.result === 'ACCEPTED' ? 'FBR_ACCEPTED' : 'FBR_REJECTED',
        brnch: prep.brnch,
        reason: out.errorMsg ?? null,
        newValues: {
          invoiceNo: prep.invoiceNo,
          fbrInvoiceNo: out.fbrInvoiceNo ?? null,
          driver: prep.driver.name,
        },
      });
  }, ctx);
  if (out.retry) throw new Error(`FBR not reached (${out.errorMsg}); will retry`);
  return out;
}

/**
 * POST …/fbr-retry (invoice.fbr_retry): FBR_REJECTED after a correction, or FBR_PENDING. When the
 * last attempt's outcome is unknown (SENT), the caller must confirm FBR has no number for it.
 */
export async function retry(tx, actor, invoiceId, { confirmNotAccepted = false } = {}) {
  const inv = await tx.one(
    'SELECT INVOICE_ID, BRNCH, STATUS FROM SALES_INVOICE WHERE INVOICE_ID = :id FOR UPDATE',
    {
      id: invoiceId,
    },
  );
  if (!inv) throw Errors.notFound('Invoice');
  if (!['FBR_REJECTED', 'FBR_PENDING', 'FINAL'].includes(inv.STATUS))
    throw Errors.invalidState(`Invoice is ${inv.STATUS}: nothing to send again`);
  const last = await lastAttempt(tx, invoiceId);
  if (last?.RESULT === 'SENT') {
    if (!confirmNotAccepted)
      throw Errors.rule(
        'BR-FBR-05',
        'The last attempt may have reached FBR. Check the FBR portal for this invoice; if it has no FBR number, retry with confirmNotAccepted',
      );
    await tx.exec(`UPDATE FBR_SUBMISSION SET RESULT = 'UNKNOWN' WHERE SUB_ID = :id`, {
      id: last.SUB_ID,
    });
  }
  const r = await enqueue(tx, {
    brnch: Number(inv.BRNCH),
    eventType: 'FBR_SUBMIT',
    aggregateType: 'SALES_INVOICE',
    aggregateKey: String(invoiceId),
    channel: 'JOB',
    dedupKey: `FBR_SUBMIT|${invoiceId}|${actor.now.getTime()}`,
    payload: { invoiceId },
    now: actor.now,
  });
  await recordAudit(tx, actor.audit, {
    entity: 'SALES_INVOICE',
    key: String(invoiceId),
    action: 'FBR_RETRY',
    brnch: Number(inv.BRNCH),
    newValues: { confirmNotAccepted, outboxId: r.outboxId },
  });
  return { outboxId: r.outboxId };
}

/** Attempts of an invoice, newest first (request and answer bodies). */
export async function submissions(tx, invoiceId) {
  const rows = await tx.many(
    `SELECT SUB_ID, ATTEMPT_NO, FBR_ENV, REQUEST_BODY, RESPONSE_BODY, HTTP_STATUS, RESULT, FBR_INVOICE_NO,
            ERROR_CODE, ERROR_MSG, DURATION_MS, SUBMITTED_ON
       FROM FBR_SUBMISSION WHERE INVOICE_ID = :id ORDER BY ATTEMPT_NO DESC`,
    { id: invoiceId },
  );
  const parse = (s) => {
    try {
      return s ? JSON.parse(s) : null;
    } catch {
      return s;
    }
  };
  return rows.map((r) => ({
    subId: Number(r.SUB_ID),
    attemptNo: Number(r.ATTEMPT_NO),
    env: r.FBR_ENV,
    request: parse(r.REQUEST_BODY),
    response: parse(r.RESPONSE_BODY),
    httpStatus: r.HTTP_STATUS === null ? null : Number(r.HTTP_STATUS),
    result: r.RESULT,
    fbrInvoiceNo: r.FBR_INVOICE_NO ?? null,
    errorCode: r.ERROR_CODE ?? null,
    errorMsg: r.ERROR_MSG ?? null,
    durationMs: r.DURATION_MS === null ? null : Number(r.DURATION_MS),
    submittedOn: r.SUBMITTED_ON,
  }));
}
