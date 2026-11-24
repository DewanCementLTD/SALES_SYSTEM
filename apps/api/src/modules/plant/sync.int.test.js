// Offline sync (TASKS P3-10 AC: offline gate-in → reconnect → one gate pass, one DC; replay safe;
// conflict appears in the queue). BR-OFF-01…04. SALES_NEW, rolled back.
import { randomUUID } from 'node:crypto';
import { signTokenRequest } from '@dcl/shared';
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

async function seed() {
  return t.db.withTx(async (tx) => {
    const geo = await tx.one(
      `SELECT GEO_CODE FROM GEO_HIERARCHY WHERE BRNCH = 1 AND CITY_NAME IS NOT NULL AND ROWNUM = 1`,
    );
    for (const [no, st] of [
      ['22799000001', 'ISSUED'],
      ['22799000003', 'CANCELLED'],
    ])
      await tx.exec(
        `INSERT INTO DELIVERY_ORDER (DEL_ORDER_NO, DO_TYPE, BRNCH, COMPC, YEAR, CUSTOMER_CODE, ORDER_NO, SR_NO,
           ORDER_DATE, SCHED_DATE, DO_QUANTITY, QTY_TYPE, NO_OF_BAGS, CANCEL_CODE, POST, DOC_STATUS, ROW_VER,
           DO_RATE, DO_VALUE, PRICE_CODE, PRODUCT_CODE, DISPATCHED_TON, QR_VER, CREATED_BY, CREATED_ON, DEST_GEO_CODE)
         VALUES (:n, 'OS', 1, 1, 2027, '912-351', 227000758, 1, :d, :d, 35, 'BAGS', 700, 'N', 'N', :st, 1,
           24300, 850500, 'MRMOSDDU03', 'OPC', 0, 1, 'test', :d, :g)`,
        { n: no, st, d: new Date('2026-11-23T00:00:00+05:00'), g: geo.GEO_CODE },
      );
    return (await tx.one('SELECT TRANSP_CODE FROM TRANSPORTER_DESC WHERE BRNCH = 1 AND ROWNUM = 1'))
      .TRANSP_CODE;
  });
}
const gateInPayload = (transp, doNo, vehicleNo = 'TKN-4521') => ({
  route: 'DO',
  packingType: 'BAG',
  vehicleNo,
  driver: { cnic: '4210112345671', name: 'Ali Khan', mobile: '03001234567' },
  transpCode: transp,
  biltyNo: 'B-1',
  docs: [{ doType: 'OS', doNo, plannedBags: 300 }],
});
const deviceTime = '2026-11-23T04:50:00.000Z';
const manual = (kg) => ({ weightKg: kg, reason: 'Network down, weight read from the display' });

describe('offline sync (P3-10)', () => {
  it('BR-OFF-03/04: offline gate-in, tare and gross apply in order; the replay changes nothing', async () => {
    const transp = await seed();
    const sup = await as({ 1: ['DISPATCH_SUPERVISOR'] });
    const gpClientId = randomUUID();
    const events = [
      {
        clientId: gpClientId,
        type: 'GATE_IN',
        deviceTime,
        payload: gateInPayload(transp, '22799000001'),
      },
      {
        clientId: randomUUID(),
        type: 'TARE',
        deviceTime,
        payload: { gpClientId, ...manual(15000) },
      },
      {
        clientId: randomUUID(),
        type: 'GROSS',
        deviceTime,
        payload: { gpClientId, ...manual(30000) },
      },
    ];
    let r = await sup.post('/api/v1/plant/sync', { events });
    expect(r.statusCode, r.body).toBe(200);
    const first = r.json().results;
    expect(first.map((x) => x.status)).toEqual(['APPLIED', 'APPLIED', 'APPLIED']);
    expect(first[0].result).toMatchObject({ status: 'IN', dcNo: expect.any(String) }); // DC number on sync
    expect(first[2].result).toMatchObject({ netKg: 15000, varianceStatus: 'OK' });

    r = await sup.post('/api/v1/plant/sync', { events }); // the tablet did not get the answer
    expect(r.json().results.map((x) => x.status)).toEqual(['DUPLICATE', 'DUPLICATE', 'DUPLICATE']);
    expect(r.json().results[0].result).toEqual(first[0].result);
    const counts = await t.db.read((tx) =>
      tx.one(
        `SELECT (SELECT COUNT(*) FROM GATE_PASS WHERE CLIENT_ID = :c) AS GP,
                (SELECT COUNT(*) FROM FH_DELIVERY_CHALLAN WHERE GP_ID = (SELECT GP_ID FROM GATE_PASS WHERE CLIENT_ID = :c)) AS DC,
                (SELECT COUNT(*) FROM WEIGH_TICKET WHERE GP_ID = (SELECT GP_ID FROM GATE_PASS WHERE CLIENT_ID = :c)) AS WT
           FROM DUAL`,
        { c: gpClientId },
      ),
    );
    expect([counts.GP, counts.DC, counts.WT].map(Number)).toEqual([1, 1, 2]);
  });

  it('BR-OFF-04: a failed event goes to the conflict queue; retry after fixing, or discard', async () => {
    const transp = await seed();
    const sup = await as({ 1: ['DISPATCH_SUPERVISOR'] });
    // the vehicle is already inside (online gate-in) → the offline gate-in conflicts
    const online = await sup.post(
      '/api/v1/plant/gate-passes',
      gateInPayload(transp, '22799000001'),
      { headers: { 'idempotency-key': `sync-test-${Date.now()}` } },
    );
    expect(online.statusCode, online.body).toBe(201);
    const offlineId = randomUUID();
    const r = await sup.post('/api/v1/plant/sync', {
      events: [
        {
          clientId: offlineId,
          type: 'GATE_IN',
          deviceTime,
          payload: gateInPayload(transp, '22799000001'),
        },
        {
          clientId: randomUUID(),
          type: 'GATE_IN',
          deviceTime,
          payload: gateInPayload(transp, '22799000003', 'LES-9'),
        },
      ],
    });
    const [busy, cancelled] = r.json().results;
    expect(busy).toMatchObject({ status: 'CONFLICT', error: { ruleId: 'BR-GATE-04' } });
    expect(cancelled).toMatchObject({ status: 'CONFLICT', error: { ruleId: 'BR-QR-02' } });

    const list = (await sup.get('/api/v1/plant/sync-conflicts?status=OPEN')).json().items;
    expect(list.map((c) => c.conflictId)).toEqual(
      expect.arrayContaining([busy.conflictId, cancelled.conflictId]),
    );
    // the first truck is aborted (it was a mistake); the offline gate-in is applied on retry
    await sup.post(
      `/api/v1/plant/gate-passes/${online.json().gpId}/abort`,
      { reason: 'Duplicate entry, truck entered once' },
      { headers: { 'idempotency-key': `sync-test-abort-${Date.now()}` } },
    );
    let res = await sup.post(`/api/v1/plant/sync-conflicts/${busy.conflictId}/resolve`, {
      action: 'RETRY',
      resolution: 'Online duplicate aborted, offline entry kept',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      conflict: { status: 'RESOLVED' },
      result: { status: 'IN' },
    });
    res = await sup.post(`/api/v1/plant/sync-conflicts/${cancelled.conflictId}/resolve`, {
      action: 'DISCARD',
      resolution: 'DO was cancelled; truck sent back',
    });
    expect(res.json().conflict.status).toBe('DISCARDED');
    // the tablet's replay now returns the applied result
    const replay = await sup.post('/api/v1/plant/sync', {
      events: [
        {
          clientId: offlineId,
          type: 'GATE_IN',
          deviceTime,
          payload: gateInPayload(transp, '22799000001'),
        },
      ],
    });
    expect(replay.json().results[0]).toMatchObject({
      status: 'DUPLICATE',
      result: { status: 'IN' },
    });
  });

  it('P-6: a gate tablet pushes gate-in and exit only', async () => {
    const transp = await seed();
    const admin = await as({ 1: ['SYS_ADMIN'] });
    const { secret } = (
      await admin.post('/api/v1/admin/devices', {
        deviceId: 'KHI-TEST-GT-01',
        brnch: 1,
        deviceType: 'GATE',
        deviceName: 'Gate tablet',
      })
    ).json();
    const token = (
      await t.app.inject({
        method: 'POST',
        url: '/api/v1/devices/token',
        payload: await signTokenRequest('KHI-TEST-GT-01', secret, t.clock.now()),
      })
    ).json().token;
    const gpClientId = randomUUID();
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/v1/plant/sync',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        events: [
          {
            clientId: gpClientId,
            type: 'GATE_IN',
            deviceTime,
            payload: gateInPayload(transp, '22799000001'),
          },
          {
            clientId: randomUUID(),
            type: 'TARE',
            deviceTime,
            payload: { gpClientId, ...manual(15000) },
          },
        ],
      },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().results.map((x) => x.status)).toEqual(['APPLIED', 'CONFLICT']);
    const gp = await t.db.read((tx) =>
      tx.one('SELECT GATE_IN_BY, DEVICE_ID FROM GATE_PASS WHERE CLIENT_ID = :c', { c: gpClientId }),
    );
    expect(gp).toEqual({ GATE_IN_BY: 'DEV KHI-TEST-GT-01', DEVICE_ID: 'KHI-TEST-GT-01' });
  });
});
