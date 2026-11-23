// FBR submission (TASKS P3-07; BR-FBR-01…05). SALES_NEW, rolled back. No real FBR call: the mock
// driver (no base URL) and a fake fetch for the HTTP driver.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, buildTestApp, createUser } from '../../../test/helpers/app.js';
import { submitInvoice } from './service.js';

/** @type {Awaited<ReturnType<typeof buildTestApp>>} */
let t;
beforeEach(async () => {
  t = await buildTestApp();
  t.clock.set('2026-11-23T05:00:00Z');
});
afterEach(async () => {
  await t.close();
});

async function as(roles, brnch = 1) {
  const u = await createUser(t.db, { roles });
  const c = new Client(t.app);
  await c.login(u.usrid, u.password, { brnch });
  return c;
}
let keyNo = 0;
const idem = () => ({ headers: { 'idempotency-key': `fbr-test-${Date.now()}-${(keyNo += 1)}` } });
const setting = (tx, key, value) =>
  tx.exec(
    `INSERT INTO APP_SETTING (BRNCH, SETTING_KEY, SETTING_VALUE, VALUE_TYPE, DESCR, UPDATED_BY, UPDATED_ON)
     VALUES (1, :k, :v, 'STRING', 'test', 'test', SYSDATE)`,
    { k: key, v: value },
  );

/** A finalised invoice of 15 t (DO 22799000002) and the FBR seller settings. */
async function invoiced({ seller = true } = {}) {
  const transp = await t.db.withTx(async (tx) => {
    const geo = await tx.one(
      `SELECT GEO_CODE FROM GEO_HIERARCHY WHERE BRNCH = 1 AND CITY_NAME IS NOT NULL AND ROWNUM = 1`,
    );
    await tx.exec(
      `INSERT INTO DELIVERY_ORDER (DEL_ORDER_NO, DO_TYPE, BRNCH, COMPC, YEAR, CUSTOMER_CODE, ORDER_NO, SR_NO,
         ORDER_DATE, SCHED_DATE, DO_QUANTITY, QTY_TYPE, NO_OF_BAGS, CANCEL_CODE, POST, DOC_STATUS, ROW_VER,
         DO_RATE, DO_VALUE, PRICE_CODE, PRODUCT_CODE, DISPATCHED_TON, QR_VER, CREATED_BY, CREATED_ON, DEST_GEO_CODE)
       VALUES (22799000002, 'OS', 1, 1, 2027, '912-351', 227000758, 1, :d, :d, 15, 'BAGS', 300, 'N', 'N',
         'ISSUED', 1, 24300, 364500, 'MRMOSDDU03', 'OPC', 0, 1, 'test', :d, :g)`,
      { d: new Date('2026-11-23T00:00:00+05:00'), g: geo.GEO_CODE },
    );
    await tx.exec(
      `INSERT INTO TAX_RATE (TAX_RATE_ID, COMPC, BRNCH, TAX_KIND, FILER_STATUS, SECTION, RATE_PCT,
         EFFECTIVE_FROM, DOC_STATUS, ROW_VER, CREATED_BY, CREATED_ON)
       VALUES (SEQ_TAX_RATE.NEXTVAL, 1, 0, 'WHT', 'F', '-', 0.1, :d, 'APPROVED', 1, 'test', :d)`,
      { d: new Date('2026-07-01T00:00:00+05:00') },
    );
    if (seller) {
      await setting(tx, 'FBR_SELLER_NTN', '0712345-6');
      await setting(tx, 'FBR_SELLER_NAME', 'Dewan Cement Limited');
      await setting(tx, 'FBR_SELLER_PROVINCE', 'Sindh');
      await setting(tx, 'FBR_HS_CODE', '2523.2900');
    }
    return (await tx.one('SELECT TRANSP_CODE FROM TRANSPORTER_DESC WHERE BRNCH = 1 AND ROWNUM = 1'))
      .TRANSP_CODE;
  });
  const gate = await as({ 1: ['GATE_OPERATOR'] });
  const sup = await as({ 1: ['DISPATCH_SUPERVISOR'] });
  const gp = (
    await gate.post(
      '/api/v1/plant/gate-passes',
      {
        route: 'DO',
        packingType: 'BAG',
        vehicleNo: 'TKN-4521',
        driver: { cnic: '4210112345671', name: 'Ali Khan', mobile: '03001234567' },
        transpCode: transp,
        biltyNo: 'B-1',
        docs: [{ doType: 'OS', doNo: '22799000002', plannedBags: 300 }],
      },
      idem(),
    )
  ).json();
  const manual = (kg) => ({ weightKg: kg, reason: 'Agent PC under maintenance today' });
  await sup.post(`/api/v1/plant/gate-passes/${gp.gpId}/tare`, manual(15000), idem());
  const g = (
    await sup.post(`/api/v1/plant/gate-passes/${gp.gpId}/gross`, manual(30000), idem())
  ).json();
  expect(g.invoices).toHaveLength(1);
  return g.invoices[0];
}
const deps = (fetch) => ({ encKey: t.app.config.APP_ENC_KEY, now: () => t.clock.now(), fetch });
const invoiceRow = (id) =>
  t.db.read((tx) =>
    tx.one('SELECT STATUS, FBR_INVOICE_NO FROM SALES_INVOICE WHERE INVOICE_ID = :id', { id }),
  );

describe('FBR submission (P3-07)', () => {
  it('BR-FBR-01/03/05: mock driver accepts once; the invoice never gets a second FBR number', async () => {
    const inv = await invoiced();
    const out = await submitInvoice(t.db, inv.invoiceId, deps());
    expect(out).toMatchObject({ result: 'ACCEPTED', fbrInvoiceNo: expect.stringMatching(/^MOCK/) });
    const row = await invoiceRow(inv.invoiceId);
    expect(row).toMatchObject({ STATUS: 'FBR_ACCEPTED', FBR_INVOICE_NO: out.fbrInvoiceNo });
    expect(await submitInvoice(t.db, inv.invoiceId, deps())).toEqual({ skipped: 'FBR_ACCEPTED' });

    const fin = await as({ 1: ['FINANCE'] });
    const subs = (await fin.get(`/api/v1/invoices/1/2027/${inv.invoiceNo}/fbr-submissions`)).json();
    expect(subs.items).toHaveLength(1);
    expect(subs.items[0]).toMatchObject({ attemptNo: 1, result: 'ACCEPTED', env: 'SANDBOX' });
    expect(subs.items[0].request.items[0]).toMatchObject({ hsCode: '2523.2900', quantity: 15 });
    const detail = (await fin.get(`/api/v1/invoices/1/2027/${inv.invoiceNo}`)).json();
    expect(detail).toMatchObject({ status: 'FBR_ACCEPTED', saleProceeds: '364500.00' });
  });

  it('BR-FBR-04: rejection with FBR text, retry after correction; timeouts retry; token stored encrypted', async () => {
    const inv = await invoiced();
    const admin = await as({ 1: ['SYS_ADMIN'] });
    expect(
      (await admin.put('/api/v1/admin/settings/1/FBR_TOKEN_ENC', { value: 'tok-123' })).statusCode,
    ).toBe(200);
    const stored = await t.db.read((tx) =>
      tx.one(
        `SELECT SETTING_VALUE FROM APP_SETTING WHERE BRNCH = 1 AND SETTING_KEY = 'FBR_TOKEN_ENC'`,
      ),
    );
    expect(stored.SETTING_VALUE.startsWith('v1.')).toBe(true);
    await t.db.withTx((tx) => setting(tx, 'FBR_BASE_URL', 'https://fbr.example'));

    const calls = [];
    let answer = 'reject';
    const fetch = async (url, init) => {
      calls.push([url, init.headers.authorization]);
      if (answer === 'timeout') throw new Error('socket hang up');
      const body =
        answer === 'reject'
          ? {
              validationResponse: {
                statusCode: '01',
                invoiceStatuses: [{ errorCode: '0052', error: 'Buyer NTN is not valid' }],
              },
            }
          : { invoiceNumber: 'FBR-777', validationResponse: { statusCode: '00' } };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    expect(await submitInvoice(t.db, inv.invoiceId, deps(fetch))).toMatchObject({
      result: 'REJECTED',
      errorMsg: 'Buyer NTN is not valid',
    });
    expect(calls[0]).toEqual([
      'https://fbr.example/di_data/v1/di/postinvoicedata_sb',
      'Bearer tok-123',
    ]);
    const fin = await as({ 1: ['FINANCE'] });
    const list = (await fin.get('/api/v1/invoices?status=FBR_REJECTED')).json();
    expect(list.items.find((i) => i.invoiceId === inv.invoiceId)).toMatchObject({
      fbrError: 'Buyer NTN is not valid',
    });

    // after the correction: retry queues a new FBR_SUBMIT; a timeout keeps it pending and retries
    const r = await fin.post(`/api/v1/invoices/1/2027/${inv.invoiceNo}/fbr-retry`, {});
    expect(r.statusCode, r.body).toBe(200);
    answer = 'timeout';
    await expect(submitInvoice(t.db, inv.invoiceId, deps(fetch))).rejects.toThrow(/will retry/);
    expect((await invoiceRow(inv.invoiceId)).STATUS).toBe('FBR_PENDING');
    answer = 'accept';
    expect(await submitInvoice(t.db, inv.invoiceId, deps(fetch))).toMatchObject({
      result: 'ACCEPTED',
      fbrInvoiceNo: 'FBR-777',
    });
  });

  it('BR-FBR-05: an attempt with unknown outcome is not resent until Finance confirms', async () => {
    const inv = await invoiced();
    await t.db.withTx((tx) =>
      tx.exec(
        `INSERT INTO FBR_SUBMISSION (SUB_ID, BRNCH, INVOICE_ID, ATTEMPT_NO, FBR_ENV, REQUEST_BODY, RESULT, SUBMITTED_ON)
         VALUES (SEQ_FBR_SUBMISSION.NEXTVAL, 1, :id, 1, 'SANDBOX', '{}', 'SENT', SYSDATE)`,
        { id: inv.invoiceId },
      ),
    );
    expect((await submitInvoice(t.db, inv.invoiceId, deps())).skipped).toMatch(/unknown/);
    const fin = await as({ 1: ['FINANCE'] });
    const url = `/api/v1/invoices/1/2027/${inv.invoiceNo}/fbr-retry`;
    expect((await fin.post(url, {})).json().ruleId).toBe('BR-FBR-05');
    expect((await fin.post(url, { confirmNotAccepted: true })).statusCode).toBe(200);
    expect((await submitInvoice(t.db, inv.invoiceId, deps())).result).toBe('ACCEPTED');
  });

  it('missing seller settings: not sent, shown as rejected with what is missing', async () => {
    const inv = await invoiced({ seller: false });
    const out = await submitInvoice(t.db, inv.invoiceId, deps());
    expect(out).toMatchObject({ result: 'REJECTED' });
    expect(out.errorMsg).toMatch(/seller NTN \(FBR_SELLER_NTN\)/);
    expect((await invoiceRow(inv.invoiceId)).STATUS).toBe('FBR_REJECTED');
  });
});
