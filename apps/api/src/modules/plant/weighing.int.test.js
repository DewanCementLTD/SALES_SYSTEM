// Weighing (TASKS P3-05; BR-WGT-01…07). SALES_NEW, rolled back.
import { deviceHmac, readingText, signTokenRequest } from '@dcl/shared';
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
const idem = () => ({ headers: { 'idempotency-key': `weigh-test-${Date.now()}-${(keyNo += 1)}` } });

/** Open DOs + an old exited gate pass of the vehicle (last tare 14,000 kg). */
async function seed() {
  return t.db.withTx(async (tx) => {
    const geo = await tx.one(
      `SELECT GEO_CODE FROM GEO_HIERARCHY WHERE BRNCH = 1 AND CITY_NAME IS NOT NULL AND ROWNUM = 1`,
    );
    const tr = await tx.one(
      'SELECT TRANSP_CODE FROM TRANSPORTER_DESC WHERE BRNCH = 1 AND ROWNUM = 1',
    );
    for (const [no, qty] of [
      ['22799000001', 35],
      ['22799000002', 20],
      ['22799000003', 20],
    ]) {
      await tx.exec(
        `INSERT INTO DELIVERY_ORDER (DEL_ORDER_NO, DO_TYPE, BRNCH, COMPC, YEAR, CUSTOMER_CODE, ORDER_NO,
           SR_NO, ORDER_DATE, SCHED_DATE, DO_QUANTITY, QTY_TYPE, NO_OF_BAGS, CANCEL_CODE, POST, DOC_STATUS,
           ROW_VER, DO_RATE, DO_VALUE, PRICE_CODE, PRODUCT_CODE, DISPATCHED_TON, QR_VER, CREATED_BY,
           CREATED_ON, DEST_GEO_CODE)
         VALUES (:n, 'OS', 1, 1, 2027, '912-351', 227000758, 1, :d, :d, :q, 'BAGS', :bags, 'N', 'N',
           'ISSUED', 1, 24400, :v, 'MRMOSDDU03', 'OPC', 0, 1, 'test', :d, :g)`,
        {
          n: no,
          q: qty,
          bags: qty * 20,
          v: qty * 24400,
          d: new Date('2026-11-23T00:00:00+05:00'),
          g: geo.GEO_CODE,
        },
      );
    }
    const old = await tx.nextId('SEQ_GATE_PASS');
    await tx.exec(
      `INSERT INTO GATE_PASS (GP_ID, BRNCH, STATUS, ROUTE, PACKING_TYPE, VEHICLE_NO, GATE_IN_ON, GATE_IN_BY,
         TARE_KG, TARE_ON, ROW_VER)
       VALUES (:id, 1, 'EXITED', 'DO', 'BAG', 'TKN-4521', :d, 'test', 14000, :d, 1)`,
      { id: old, d: new Date('2026-11-01T10:00:00+05:00') },
    );
    return tr.TRANSP_CODE;
  });
}

async function gateIn(gate, transp, docs, vehicleNo) {
  const r = await gate.post(
    '/api/v1/plant/gate-passes',
    {
      route: 'DO',
      packingType: 'BAG',
      vehicleNo,
      driver: { cnic: '4210112345671', name: 'Ali Khan', mobile: '03001234567' },
      transpCode: transp,
      biltyNo: 'B-1',
      docs,
    },
    idem(),
  );
  expect(r.statusCode, r.body).toBe(201);
  return r.json();
}

/** A registered weighbridge with a token; `reading(kg)` uploads a signed stable reading. */
async function weighbridge() {
  const admin = await as({ 1: ['SYS_ADMIN'] });
  const deviceId = 'KHI-TEST-WB-01';
  const { secret } = (
    await admin.post('/api/v1/admin/devices', {
      deviceId,
      brnch: 1,
      deviceType: 'WEIGHBRIDGE',
      deviceName: 'Weighbridge 1',
    })
  ).json();
  const tok = (
    await t.app.inject({
      method: 'POST',
      url: '/api/v1/devices/token',
      payload: await signTokenRequest(deviceId, secret, t.clock.now()),
    })
  ).json().token;
  let n = 0;
  return async (kg) => {
    n += 1;
    const r = {
      deviceId,
      readingId: `reading-${String(n).padStart(4, '0')}`,
      weightKg: kg,
      stable: true,
      readOn: t.clock.now().toISOString(),
    };
    const up = await t.app.inject({
      method: 'POST',
      url: '/api/v1/plant/weigh-readings',
      headers: { authorization: `Bearer ${tok}` },
      payload: { ...r, signature: await deviceHmac(secret, readingText(r)) },
    });
    expect(up.statusCode, up.body).toBe(201);
    return { deviceId, readingId: r.readingId };
  };
}

describe('weighing (P3-05)', () => {
  it('BR-WGT-01/03/04/06: agent tare and gross, net split over the DC lines, readings single use', async () => {
    const transp = await seed();
    const gate = await as({ 1: ['GATE_OPERATOR'] });
    const gp = await gateIn(
      gate,
      transp,
      [
        { doType: 'OS', doNo: '22799000001', plannedBags: 400 },
        { doType: 'OS', doNo: '22799000002', plannedBags: 300 },
      ],
      'TKN-4521',
    );
    const reading = await weighbridge();
    const wo = await as({ 1: ['WEIGH_OPERATOR'] });
    const base = `/api/v1/plant/gate-passes/${gp.gpId}`;

    // gross before tare
    const early = await wo.post(`${base}/gross`, await reading(50100), idem());
    expect(early.statusCode).toBe(409);

    const tareReading = await reading(15020);
    let r = await wo.post(`${base}/tare`, tareReading, idem());
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().gatePass).toMatchObject({ status: 'TARE_DONE', tareKg: 15020 });
    expect(r.json().warnings[0]).toMatch(/last tare 14000 kg by \+1020 kg/); // BR-WGT-03 warning only

    // a reading is used once (BR-WGT-07)
    r = await wo.post(`${base}/gross`, tareReading, idem());
    expect(r.statusCode).toBe(409);
    // manual weight needs weigh.manual
    r = await wo.post(
      `${base}/gross`,
      { weightKg: 50100, reason: 'Indicator display broken' },
      idem(),
    );
    expect(r.statusCode).toBe(403);

    r = await wo.post(`${base}/gross`, await reading(50100), idem());
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      net: 35080,
      variance: 80,
      direction: 'OVER',
      varianceStatus: 'OK',
      gatePass: { status: 'GROSS_DONE', netKg: 35080, varianceStatus: 'OK' },
    });
    expect(r.json().gatePass.lines.map((l) => [l.allocNetKg, l.status])).toEqual([
      [20046, 'WEIGHED'],
      [15034, 'WEIGHED'],
    ]);
    const dc = await t.db.read((tx) =>
      tx.one(
        `SELECT DOC_STATUS, W_TARE, WT_GROSS, QTY_VERIFIED, NET_KG FROM FH_DELIVERY_CHALLAN
          WHERE BRNCH = 1 AND DC_TYPE = 'OS' AND DC_NO = :n`,
        { n: r.json().gatePass.dcNo },
      ),
    );
    expect(dc.DOC_STATUS).toBe('WEIGHED');
    expect([dc.W_TARE, dc.WT_GROSS, dc.NET_KG].map(Number)).toEqual([15020, 50100, 35080]);
    expect(Number(dc.QTY_VERIFIED)).toBe(35.08);
  });

  it('BR-WGT-02/05: manual weights; outside tolerance blocks; re-weigh; override by approval', async () => {
    const transp = await seed();
    const gate = await as({ 1: ['GATE_OPERATOR'] });
    const pm = await as({ 1: ['PLANT_MANAGER'] });
    const pm2 = await as({ 1: ['PLANT_MANAGER'] });
    const wo = await as({ 1: ['WEIGH_OPERATOR'] });
    const manual = (kg) => ({ weightKg: kg, reason: 'Weighbridge agent PC is down' });

    // truck 1: blocked (+480 kg), re-weighed within tolerance
    const a = await gateIn(
      gate,
      transp,
      [{ doType: 'OS', doNo: '22799000002', plannedBags: 400 }],
      'LES-1',
    );
    let r = await pm.post(`/api/v1/plant/gate-passes/${a.gpId}/tare`, manual(15000), idem());
    expect(r.statusCode, r.body).toBe(200);
    r = await pm.post(`/api/v1/plant/gate-passes/${a.gpId}/gross`, manual(35480), idem());
    expect(r.json()).toMatchObject({
      variance: 480,
      varianceStatus: 'BLOCKED',
      gatePass: { status: 'VARIANCE_BLOCKED' },
    });
    r = await pm.post(`/api/v1/plant/gate-passes/${a.gpId}/reweigh`, manual(35050), idem());
    expect(r.json()).toMatchObject({ variance: 50, gatePass: { status: 'GROSS_DONE' } });
    const tickets = await t.db.read((tx) =>
      tx.many(
        `SELECT WEIGH_TYPE, WEIGHT_KG, SOURCE, REASON FROM WEIGH_TICKET WHERE GP_ID = :g ORDER BY TICKET_ID`,
        {
          g: a.gpId,
        },
      ),
    );
    expect(tickets.map((x) => [x.WEIGH_TYPE, Number(x.WEIGHT_KG), x.SOURCE])).toEqual([
      ['TARE', 15000, 'MANUAL'],
      ['GROSS', 35480, 'MANUAL'],
      ['GROSS', 35050, 'MANUAL'],
    ]);

    // truck 2: blocked (−700 kg), override through WEIGHT_OVERRIDE (another plant manager approves)
    const b = await gateIn(
      gate,
      transp,
      [{ doType: 'OS', doNo: '22799000003', plannedBags: 400 }],
      'LES-2',
    );
    await pm.post(`/api/v1/plant/gate-passes/${b.gpId}/tare`, manual(15000), idem());
    await pm.post(`/api/v1/plant/gate-passes/${b.gpId}/gross`, manual(34300), idem());
    const reason = { reason: 'Customer accepts 19.3 t, short loading agreed by phone' };
    expect(
      (await wo.post(`/api/v1/plant/gate-passes/${b.gpId}/request-weight-override`, reason, idem()))
        .statusCode,
    ).toBe(403);
    r = await pm.post(
      `/api/v1/plant/gate-passes/${b.gpId}/request-weight-override`,
      reason,
      idem(),
    );
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().requestId).toEqual(expect.any(Number));
    expect(r.json().gatePass.status).toBe('VARIANCE_BLOCKED');
    const ok = await pm2.post(`/api/v1/approvals/${r.json().requestId}/approve`, {});
    expect(ok.statusCode, ok.body).toBe(200);
    const after = (await pm.get(`/api/v1/plant/gate-passes/${b.gpId}`)).json();
    expect(after).toMatchObject({
      status: 'OVERRIDDEN',
      varianceStatus: 'OVERRIDDEN',
      varianceKg: -700,
    });
  });
});
