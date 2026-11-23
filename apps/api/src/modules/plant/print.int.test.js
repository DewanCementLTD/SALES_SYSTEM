// DC details and prints (TASKS P3-11; BR-DC-03, BR-EXIT-01, BR-QR-04). SALES_NEW, rolled back.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, buildTestApp, createUser } from '../../../test/helpers/app.js';

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
const idem = () => ({ headers: { 'idempotency-key': `print-test-${Date.now()}-${(keyNo += 1)}` } });

async function seed() {
  return t.db.withTx(async (tx) => {
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
    const bag = await tx.one(
      `SELECT BAG_CD FROM BAG WHERE BRNCH = 1 AND NVL(ACTIVE, 'Y') = 'Y' AND ROWNUM = 1`,
    );
    const tr = await tx.one(
      'SELECT TRANSP_CODE FROM TRANSPORTER_DESC WHERE BRNCH = 1 AND ROWNUM = 1',
    );
    return { transp: tr.TRANSP_CODE, bag: Number(bag.BAG_CD) };
  });
}
const outboxPayload = (id) =>
  t.db
    .read((tx) => tx.one('SELECT PAYLOAD FROM NOTIFICATION_OUTBOX WHERE OUTBOX_ID = :i', { i: id }))
    .then((r) => JSON.parse(r.PAYLOAD));

describe('DC details and prints (P3-11)', () => {
  it('BR-DC-03 details before invoicing; DC and invoice prints are queued with their data', async () => {
    const { transp, bag } = await seed();
    const gate = await as({ 1: ['GATE_OPERATOR'] });
    const sup = await as({ 1: ['DISPATCH_SUPERVISOR', 'FINANCE'] });
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
    const base = `/api/v1/plant/gate-passes/${gp.gpId}`;
    let r = await sup.put(`${base}/dc`, {
      bagSupplier: 'Pakland',
      bagsId: bag,
      containerNo: 'MSKU1234567',
      sealNo: 'S-99',
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      bagSupplier: 'Pakland',
      bagsId: bag,
      containerNo: 'MSKU1234567',
    });
    expect((await sup.put(`${base}/dc`, { bagsId: 999999 })).statusCode).toBe(400);

    const manual = (kg) => ({ weightKg: kg, reason: 'Agent PC under maintenance today' });
    await sup.post(`${base}/tare`, manual(15000), idem());
    const g = (await sup.post(`${base}/gross`, manual(30000), idem())).json();
    expect(g.gatePass.status).toBe('INVOICED');
    // after the invoices the DC no longer changes
    expect((await sup.put(`${base}/dc`, { remarks: 'late change' })).statusCode).toBe(409);

    r = await sup.post(`${base}/print`, {});
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json().entityKey).toBe(`1|OS|${gp.dcNo}`);
    let p = await outboxPayload(r.json().outboxId);
    expect(p.template).toBe('delivery-challan');
    expect(p.data).toMatchObject({
      brnch: 1,
      gatePass: { gpId: gp.gpId, netKg: 15000 },
      dc: { bagSupplier: 'Pakland', sealNo: 'S-99' },
      customer: { code: '912-351' },
    });
    expect(p.data.lines[0]).toMatchObject({
      doNo: '22799000002',
      tons: '15.000',
      productCode: 'OPC',
    });

    const inv = g.invoices[0];
    r = await sup.post(`/api/v1/invoices/1/2027/${inv.invoiceNo}/print`, {});
    expect(r.statusCode, r.body).toBe(202);
    p = await outboxPayload(r.json().outboxId);
    expect(p.template).toBe('sales-invoice');
    expect(p.data.invoice).toMatchObject({
      invoiceNo: inv.invoiceNo,
      qtyTon: '15.000',
      saleProceeds: '364500.00',
      buyer: { code: '912-351' },
    });
  });
});
