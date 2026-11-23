// Abort and DC cancel (TASKS P3-09; BR-DC-CXL-01…03). SALES_NEW, rolled back.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, buildTestApp, createUser } from '../../../test/helpers/app.js';
import { submitInvoice } from '../fbr/service.js';
import * as ledger from '../ledger/service.js';

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
const idem = () => ({ headers: { 'idempotency-key': `cxl-test-${Date.now()}-${(keyNo += 1)}` } });
const CUST = '912-351';

async function seed() {
  return t.db.withTx(async (tx) => {
    const geo = await tx.one(
      `SELECT GEO_CODE FROM GEO_HIERARCHY WHERE BRNCH = 1 AND CITY_NAME IS NOT NULL AND ROWNUM = 1`,
    );
    await tx.exec(
      `INSERT INTO DELIVERY_ORDER (DEL_ORDER_NO, DO_TYPE, BRNCH, COMPC, YEAR, CUSTOMER_CODE, ORDER_NO, SR_NO,
         ORDER_DATE, SCHED_DATE, DO_QUANTITY, QTY_TYPE, NO_OF_BAGS, CANCEL_CODE, POST, DOC_STATUS, ROW_VER,
         DO_RATE, DO_VALUE, PRICE_CODE, PRODUCT_CODE, DISPATCHED_TON, QR_VER, CREATED_BY, CREATED_ON, DEST_GEO_CODE)
       VALUES (22799000002, 'OS', 1, 1, 2027, :c, 227000758, 1, :d, :d, 15, 'BAGS', 300, 'N', 'N',
         'ISSUED', 1, 24300, 364500, 'MRMOSDDU03', 'OPC', 0, 1, 'test', :d, :g)`,
      { c: CUST, d: new Date('2026-11-23T00:00:00+05:00'), g: geo.GEO_CODE },
    );
    await tx.exec(
      `INSERT INTO TAX_RATE (TAX_RATE_ID, COMPC, BRNCH, TAX_KIND, FILER_STATUS, SECTION, RATE_PCT,
         EFFECTIVE_FROM, DOC_STATUS, ROW_VER, CREATED_BY, CREATED_ON)
       VALUES (SEQ_TAX_RATE.NEXTVAL, 1, 0, 'WHT', 'F', '-', 0.1, :d, 'APPROVED', 1, 'test', :d)`,
      { d: new Date('2026-07-01T00:00:00+05:00') },
    );
    for (const [k, v] of [
      ['FBR_SELLER_NTN', '0712345-6'],
      ['FBR_SELLER_NAME', 'Dewan Cement Limited'],
      ['FBR_SELLER_PROVINCE', 'Sindh'],
      ['FBR_HS_CODE', '2523.2900'],
    ])
      await tx.exec(
        `INSERT INTO APP_SETTING (BRNCH, SETTING_KEY, SETTING_VALUE, VALUE_TYPE, DESCR, UPDATED_BY, UPDATED_ON)
         VALUES (1, :k, :v, 'STRING', 'test', 'test', SYSDATE)`,
        { k, v },
      );
    return (await tx.one('SELECT TRANSP_CODE FROM TRANSPORTER_DESC WHERE BRNCH = 1 AND ROWNUM = 1'))
      .TRANSP_CODE;
  });
}

async function gateIn(transp) {
  const gate = await as({ 1: ['GATE_OPERATOR'] });
  const r = await gate.post(
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
  );
  expect(r.statusCode, r.body).toBe(201);
  return r.json();
}
const manual = (kg) => ({ weightKg: kg, reason: 'Agent PC under maintenance today' });
const dcLedger = () =>
  t.db.read((tx) => ledger.balance(tx, { brnch: 1, customerCode: CUST, ledgerType: 'DC' }));

describe('abort and DC cancel (P3-09)', () => {
  it('BR-DC-CXL-01: abort before any invoice cancels the DC and frees the vehicle', async () => {
    const transp = await seed();
    const gp = await gateIn(transp);
    const pm = await as({ 1: ['PLANT_MANAGER'] });
    await pm.post(`/api/v1/plant/gate-passes/${gp.gpId}/tare`, manual(15000), idem());
    const reason = { reason: 'Driver refused the load, truck went back empty' };
    const r = await pm.post(`/api/v1/plant/gate-passes/${gp.gpId}/abort`, reason, idem());
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ status: 'ABORTED' });
    expect(r.json().lines[0].status).toBe('CANCELLED');
    const dc = await t.db.read((tx) =>
      tx.one(
        `SELECT DOC_STATUS, CANCEL_CODE FROM FH_DELIVERY_CHALLAN WHERE BRNCH = 1 AND DC_TYPE = 'OS' AND DC_NO = :n`,
        { n: gp.dcNo },
      ),
    );
    expect(dc).toEqual({ DOC_STATUS: 'CANCELLED', CANCEL_CODE: 'Y' });
    expect(
      (await pm.post(`/api/v1/plant/gate-passes/${gp.gpId}/abort`, reason, idem())).statusCode,
    ).toBe(409);
    // the vehicle and the DO balance are free again
    expect((await gateIn(transp)).status).toBe('IN');
  });

  it('BR-DC-CXL-02: invoiced DC cancelled through DC_CANCEL: invoice, ledger and DO restored', async () => {
    const transp = await seed();
    const before = await dcLedger();
    const gp = await gateIn(transp);
    const pm = await as({ 1: ['PLANT_MANAGER'] });
    const fm = await as({ 1: ['FINANCE_MANAGER'] });
    await pm.post(`/api/v1/plant/gate-passes/${gp.gpId}/tare`, manual(15000), idem());
    const g = (
      await pm.post(`/api/v1/plant/gate-passes/${gp.gpId}/gross`, manual(30000), idem())
    ).json();
    expect(g.gatePass.status).toBe('INVOICED');
    expect(Number(await dcLedger()) - Number(before)).toBeCloseTo(364864.5, 2); // 364,500 + WHT 364.50

    const reason = { reason: 'Wrong customer DO loaded, cement unloaded' };
    expect(
      (await pm.post(`/api/v1/plant/gate-passes/${gp.gpId}/abort`, reason, idem())).json().ruleId,
    ).toBe('BR-DC-CXL-01');
    const r = await pm.post(`/api/v1/plant/dc/1/OS/${gp.dcNo}/cancel`, reason, idem());
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().requestId).toEqual(expect.any(Number));
    expect((await fm.post(`/api/v1/approvals/${r.json().requestId}/approve`, {})).statusCode).toBe(
      200,
    );

    const inv = await t.db.read((tx) =>
      tx.one('SELECT STATUS, CANCEL_REASON FROM SALES_INVOICE WHERE INVOICE_ID = :id', {
        id: g.invoices[0].invoiceId,
      }),
    );
    expect(inv).toEqual({ STATUS: 'CANCELLED', CANCEL_REASON: reason.reason });
    expect(await dcLedger()).toBe(before);
    const d = await t.db.read((tx) =>
      tx.one(
        `SELECT DISPATCHED_TON, DOC_STATUS FROM DELIVERY_ORDER WHERE BRNCH = 1 AND DEL_ORDER_NO = 22799000002`,
      ),
    );
    expect([Number(d.DISPATCHED_TON), d.DOC_STATUS]).toEqual([0, 'ISSUED']);
    const gpNow = (await pm.get(`/api/v1/plant/gate-passes/${gp.gpId}`)).json();
    expect(gpNow.status).toBe('ABORTED');
    // the FBR job finds the invoice cancelled and does nothing
    expect(
      await submitInvoice(t.db, g.invoices[0].invoiceId, {
        encKey: t.app.config.APP_ENC_KEY,
        now: () => t.clock.now(),
      }),
    ).toEqual({ skipped: 'CANCELLED' });
  });

  it('BR-DC-CXL-03: once FBR gave a number, no cancel: credit note', async () => {
    const transp = await seed();
    const gp = await gateIn(transp);
    const pm = await as({ 1: ['PLANT_MANAGER'] });
    await pm.post(`/api/v1/plant/gate-passes/${gp.gpId}/tare`, manual(15000), idem());
    const g = (
      await pm.post(`/api/v1/plant/gate-passes/${gp.gpId}/gross`, manual(30000), idem())
    ).json();
    await submitInvoice(t.db, g.invoices[0].invoiceId, {
      encKey: t.app.config.APP_ENC_KEY,
      now: () => t.clock.now(),
    });
    const r = await pm.post(
      `/api/v1/plant/dc/1/OS/${gp.dcNo}/cancel`,
      { reason: 'Customer returned the truck after invoicing' },
      idem(),
    );
    expect(r.json()).toMatchObject({ ruleId: 'BR-DC-CXL-03' });
    expect(r.json().detail).toMatch(/credit note/);
  });
});
