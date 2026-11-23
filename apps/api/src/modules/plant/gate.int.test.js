// Gate-in, DO route (TASKS P3-04; BR-GATE-02…06, BR-DC-01/02). SALES_NEW, rolled back.
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
const idem = () => ({ headers: { 'idempotency-key': `gate-test-${Date.now()}-${(keyNo += 1)}` } });

/** Two open DOs of 912-351 to the same city, one of another customer; returns codes. */
async function seed() {
  return t.db.withTx(async (tx) => {
    const geo = await tx.one(
      `SELECT GEO_CODE, LEGACY_CODE FROM GEO_HIERARCHY WHERE BRNCH = 1 AND CITY_NAME IS NOT NULL
         AND LEGACY_CODE IS NOT NULL AND ROWNUM = 1`,
    );
    const tr = await tx.one(
      'SELECT TRANSP_CODE FROM TRANSPORTER_DESC WHERE BRNCH = 1 AND ROWNUM = 1',
    );
    const other = await tx.one(
      `SELECT CUSTOMER_CODE FROM CUSTOMER_INFO WHERE BRNCH = 1 AND CUSTOMER_CODE <> '912-351' AND ROWNUM = 1`,
    );
    const ins = (no, cust, qty, disp) =>
      tx.exec(
        `INSERT INTO DELIVERY_ORDER (DEL_ORDER_NO, DO_TYPE, BRNCH, COMPC, YEAR, CUSTOMER_CODE, ORDER_NO,
           SR_NO, ORDER_DATE, SCHED_DATE, DO_QUANTITY, QTY_TYPE, NO_OF_BAGS, CANCEL_CODE, POST, DOC_STATUS,
           ROW_VER, DO_RATE, DO_VALUE, PRICE_CODE, PRODUCT_CODE, DISPATCHED_TON, QR_VER, CREATED_BY,
           CREATED_ON, DEST_GEO_CODE)
         VALUES (:n, 'OS', 1, 1, 2027, :c, 227000758, 1, :d, :d, :q, 'BAGS', :bags, 'N', 'N', :st, 1,
           24400, :v, 'MRMOSDDU03', 'OPC', :disp, 1, 'test', :d, :g)`,
        {
          n: no,
          c: cust,
          q: qty,
          bags: qty * 20,
          st: disp > 0 ? 'PARTLY_DISPATCHED' : 'ISSUED',
          v: qty * 24400,
          disp,
          d: new Date('2026-11-23T00:00:00+05:00'),
          g: geo.GEO_CODE,
        },
      );
    await ins('22799000001', '912-351', 35, 10);
    await ins('22799000002', '912-351', 20, 0);
    await ins('22799000003', other.CUSTOMER_CODE, 20, 0);
    return { transp: tr.TRANSP_CODE, city: String(geo.LEGACY_CODE) };
  });
}
const body = (transp, docs, extra = {}) => ({
  route: 'DO',
  packingType: 'BAG',
  vehicleNo: 'TKN-4521',
  driver: { cnic: '4210112345671', name: 'Ali Khan', mobile: '03001234567' },
  transpCode: transp,
  biltyNo: 'B-778',
  docs,
  ...extra,
});

describe('gate-in, DO route (P3-04)', () => {
  it('BR-GATE-06: gate pass and DC with planned quantities; vehicle, balance and combine rules', async () => {
    const { transp, city } = await seed();
    const gate = await as({ 1: ['GATE_OPERATOR'] });
    const docs = [
      { doType: 'OS', doNo: '22799000001', plannedBags: 400 },
      { doType: 'OS', doNo: '22799000002', plannedBags: 300 },
    ];
    expect((await gate.post('/api/v1/plant/gate-passes', body(transp, docs))).statusCode).toBe(400); // no Idempotency-Key

    let r = await gate.post('/api/v1/plant/gate-passes', body(transp, docs), idem());
    expect(r.statusCode, r.body).toBe(201);
    const gp = r.json();
    expect(gp).toMatchObject({
      status: 'IN',
      route: 'DO',
      customerCode: '912-351',
      dcType: 'OS',
      destArea: city,
      vehicleNo: 'TKN-4521',
      plannedBags: 700,
      plannedKg: 35000,
      driver: { cnic: '42101-*******-1' },
    });
    expect(gp.dcNo).toMatch(/^\d+$/);
    expect(gp.lines.map((l) => [l.doNo, l.plannedBags, l.plannedTon, l.status])).toEqual([
      ['22799000001', 400, '20.000', 'ISSUED'],
      ['22799000002', 300, '15.000', 'ISSUED'],
    ]);
    const dc = await t.db.read((tx) =>
      tx.one(
        `SELECT DOC_STATUS, QUANTITY, GP_ID, VEHICLE_NO, PLANNED_KG, CITY_CD FROM FH_DELIVERY_CHALLAN
          WHERE BRNCH = 1 AND DC_TYPE = 'OS' AND DC_NO = :n`,
        { n: gp.dcNo },
      ),
    );
    expect(dc).toMatchObject({
      DOC_STATUS: 'ISSUED',
      QUANTITY: '35',
      GP_ID: gp.gpId,
      VEHICLE_NO: 'TKN-4521',
    });

    // BR-GATE-04: same vehicle again
    r = await gate.post('/api/v1/plant/gate-passes', body(transp, docs), idem());
    expect(r.json()).toMatchObject({ ruleId: 'BR-GATE-04', data: { gpId: gp.gpId } });
    // BR-DC-02: DO 1 has 25 t left, 20 t already planned on the open gate pass
    r = await gate.post(
      '/api/v1/plant/gate-passes',
      body(transp, [{ doType: 'OS', doNo: '22799000001', plannedBags: 200 }], {
        vehicleNo: 'LES-1',
      }),
      idem(),
    );
    expect(r.json().ruleId).toBe('BR-DC-02');
    // BR-GATE-03: another customer's DO on the same truck
    r = await gate.post(
      '/api/v1/plant/gate-passes',
      body(
        transp,
        [
          { doType: 'OS', doNo: '22799000002', plannedBags: 20 },
          { doType: 'OS', doNo: '22799000003', plannedBags: 20 },
        ],
        { vehicleNo: 'LES-2' },
      ),
      idem(),
    );
    expect(r.json()).toMatchObject({ ruleId: 'BR-GATE-03' });

    // board and detail
    const board = (await gate.get('/api/v1/plant/board')).json();
    expect(board.items.find((x) => x.gpId === gp.gpId)).toMatchObject({ waitMin: 0 });
    expect((await gate.get(`/api/v1/plant/gate-passes/${gp.gpId}`)).json().lines).toHaveLength(2);
    const isb = await as({ 2: ['GATE_OPERATOR'] }, 2);
    expect((await isb.get(`/api/v1/plant/gate-passes/${gp.gpId}`)).statusCode).toBe(404);
  });

  it('offline replay by client id returns the same gate pass; bilty and permit route', async () => {
    const { transp } = await seed();
    const gate = await as({ 1: ['GATE_OPERATOR'] });
    const b = body(transp, [{ doType: 'OS', doNo: '22799000002', plannedBags: 400 }], {
      clientId: '0193f1c2-aaaa-7000-8000-000000000001',
    });
    const first = await gate.post('/api/v1/plant/gate-passes', b, idem());
    expect(first.statusCode, first.body).toBe(201);
    const again = await gate.post('/api/v1/plant/gate-passes', b, idem());
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ gpId: first.json().gpId, replay: true });

    const noBilty = body(transp, [{ doType: 'OS', doNo: '22799000001', plannedBags: 20 }], {
      vehicleNo: 'LES-3',
      biltyNo: undefined,
    });
    expect((await gate.post('/api/v1/plant/gate-passes', noBilty, idem())).json().ruleId).toBe(
      'BR-GATE-02',
    );
    const pmt = await gate.post(
      '/api/v1/plant/gate-passes',
      { ...body(transp, [{ permitNo: '20272301.2', lnkno: 1, plannedBags: 20 }]), route: 'PMT' },
      idem(),
    );
    expect(pmt.statusCode).toBe(501);
  });
});
