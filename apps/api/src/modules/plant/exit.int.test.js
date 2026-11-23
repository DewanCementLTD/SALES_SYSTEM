// Exit (TASKS P3-08; BR-EXIT-01…03). SALES_NEW, rolled back.
import { signQr } from '@dcl/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, buildTestApp, createUser } from '../../../test/helpers/app.js';
import { submitInvoice } from '../fbr/service.js';

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
const idem = () => ({ headers: { 'idempotency-key': `exit-test-${Date.now()}-${(keyNo += 1)}` } });
const setting = (tx, key, value) =>
  tx.exec(
    `INSERT INTO APP_SETTING (BRNCH, SETTING_KEY, SETTING_VALUE, VALUE_TYPE, DESCR, UPDATED_BY, UPDATED_ON)
     VALUES (1, :k, :v, 'STRING', 'test', 'test', SYSDATE)`,
    { k: key, v: value },
  );

/** A weighed, invoiced truck (DO 22799000002, 15 t) of 912-351 with SMS on. */
async function invoicedTruck() {
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
    for (const [k, v] of [
      ['FBR_SELLER_NTN', '0712345-6'],
      ['FBR_SELLER_NAME', 'Dewan Cement Limited'],
      ['FBR_SELLER_PROVINCE', 'Sindh'],
      ['FBR_HS_CODE', '2523.2900'],
    ])
      await setting(tx, k, v);
    await tx.exec(
      `UPDATE CUSTOMER_INFO SET NOTIFY_SMS = 'Y', MOBILE_NO = '03001234567' WHERE BRNCH = 1 AND CUSTOMER_CODE = '912-351'`,
    );
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
  expect(g.gatePass.status).toBe('INVOICED');
  return { gp: g.gatePass, invoice: g.invoices[0], gate };
}
const deps = () => ({ encKey: t.app.config.APP_ENC_KEY, now: () => t.clock.now() });

describe('exit (P3-08)', () => {
  it('BR-EXIT-01…03: blocked until FBR accepted; scan the gate-pass QR; exit closes and tells the dealer', async () => {
    const { gp, invoice, gate } = await invoicedTruck();
    const base = `/api/v1/plant/gate-passes/${gp.gpId}`;
    let r = await gate.post(`${base}/exit`, {}, idem());
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({
      ruleId: 'BR-EXIT-02',
      data: { fbrPendingOnly: true, overrideAllowed: false },
    });
    expect(r.json().data.missing[0]).toMatch(new RegExp(`invoice ${invoice.invoiceNo}`));

    expect((await submitInvoice(t.db, invoice.invoiceId, deps())).result).toBe('ACCEPTED');
    const qr = await signQr(
      { docType: 'GP', brnch: 1, docNo: String(gp.gpId), ver: 1 },
      t.app.config.QR_SECRET,
    );
    r = await gate.post('/api/v1/plant/exit-scan', { qr });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      checklist: { ok: true, missing: [] },
      gatePass: { gpId: gp.gpId },
    });
    expect(r.json().invoices[0].fbrInvoiceNo).toMatch(/^MOCK/);

    r = await gate.post(`${base}/exit`, {}, idem());
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ status: 'EXITED', exitBy: expect.any(String) });
    expect((await gate.post(`${base}/exit`, {}, idem())).statusCode).toBe(409);
    const sms = await t.db.read((tx) =>
      tx.one(
        `SELECT PAYLOAD FROM NOTIFICATION_OUTBOX WHERE EVENT_TYPE = 'TRUCK_EXITED' AND AGGREGATE_KEY = :k AND CHANNEL = 'SMS'`,
        { k: String(gp.gpId) },
      ),
    );
    expect(JSON.parse(sms.PAYLOAD).text).toBe(
      `DCL: truck TKN-4521 left the plant with 15.00 t OPC (DC ${gp.dcNo}.1, invoice ${invoice.invoiceNo}).`,
    );
    const dc = await t.db.read((tx) =>
      tx.one(
        `SELECT DOC_STATUS FROM FH_DELIVERY_CHALLAN WHERE BRNCH = 1 AND DC_TYPE = 'OS' AND DC_NO = :n`,
        {
          n: gp.dcNo,
        },
      ),
    );
    expect(dc.DOC_STATUS).toBe('CLOSED');
  });

  it('OPEN-Q3: exit without FBR only when the setting allows it and the override is approved', async () => {
    const { gp, gate } = await invoicedTruck();
    const base = `/api/v1/plant/gate-passes/${gp.gpId}`;
    const pm = await as({ 1: ['PLANT_MANAGER'] });
    const pm2 = await as({ 1: ['PLANT_MANAGER'] });
    const reason = { reason: 'FBR portal down since morning, customer site waiting' };
    let r = await pm.post(`${base}/request-exit-override`, reason, idem());
    expect(r.json().detail).toMatch(/ALLOW_EXIT_WITHOUT_FBR = N/);

    await t.db.withTx((tx) => setting(tx, 'ALLOW_EXIT_WITHOUT_FBR', 'Y'));
    r = await pm.post(`${base}/request-exit-override`, reason, idem());
    expect(r.statusCode, r.body).toBe(200);
    expect((await gate.post(`${base}/exit`, {}, idem())).json().data.overrideAllowed).toBe(true);
    expect((await pm2.post(`/api/v1/approvals/${r.json().requestId}/approve`, {})).statusCode).toBe(
      200,
    );
    r = await gate.post(`${base}/exit`, {}, idem());
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().status).toBe('EXITED');
    const audit = await t.db.read((tx) =>
      tx.one(
        `SELECT ACTION FROM AUDIT_LOG WHERE ENTITY = 'GATE_PASS' AND ENTITY_KEY = :k AND ACTION LIKE 'EXIT%'`,
        {
          k: String(gp.gpId),
        },
      ),
    );
    expect(audit.ACTION).toBe('EXIT_OVERRIDE');
  });
});
