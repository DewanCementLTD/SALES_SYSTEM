// Gate scan, manual lookup and offline cache (TASKS P3-03; BR-QR-02/03, BR-GATE-01, BR-OFF-02).
// SALES_NEW, rolled back.
import { offlineQrCheck, signQr } from '@dcl/shared';
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
const DO_NO = '22799000001';

/** A new-system DO (as OC confirm writes it), printed twice (QR version 2). */
async function seedDo(status = 'ISSUED') {
  await t.db.withTx((tx) =>
    tx.exec(
      `INSERT INTO DELIVERY_ORDER (DEL_ORDER_NO, DO_TYPE, BRNCH, COMPC, YEAR, CUSTOMER_CODE, ORDER_NO,
         SR_NO, ORDER_DATE, SCHED_DATE, DO_QUANTITY, QTY_TYPE, NO_OF_BAGS, CANCEL_CODE, POST, DOC_STATUS,
         ROW_VER, DO_RATE, DO_VALUE, PRICE_CODE, PRODUCT_CODE, DISPATCHED_TON, QR_VER, CREATED_BY, CREATED_ON,
         HOLD_REASON)
       VALUES (:n, 'OS', 1, 1, 2027, '912-351', 227000758, 1, :d, :d, 35, 'BAGS', 700, 'N', 'N', :st, 1,
         24400, 854000, 'MRMOSDDU03', 'OPC', 10, 2, 'test', :d, :hr)`,
      {
        n: DO_NO,
        d: new Date('2026-11-23T00:00:00+05:00'),
        st: status,
        hr: status === 'ON_HOLD' ? 'Re-pricing shortfall' : null,
      },
    ),
  );
}
const qr = (ver = 2, brnch = 1, docNo = `OS-${DO_NO}`) =>
  signQr({ docType: 'DO', brnch, docNo, ver }, t.app.config.QR_SECRET);

describe('gate scan (P3-03)', () => {
  it('BR-QR-02/03: a current print gives the card; forged, old, other-plant prints are refused', async () => {
    await seedDo();
    const gate = await as({ 1: ['GATE_OPERATOR'] });
    const r = await gate.post('/api/v1/plant/scan', { qr: await qr() });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      docType: 'DO',
      docNo: `OS-${DO_NO}`,
      ver: 2,
      status: 'ISSUED',
      customerCode: '912-351',
      remainingTon: '25.000',
    });

    const reason = async (payload) => {
      const res = await gate.post('/api/v1/plant/scan', { qr: payload });
      expect(res.statusCode).toBe(422);
      return [res.json().ruleId, res.json().data.reason];
    };
    expect(await reason(`${(await qr()).slice(0, -3)}xyz`)).toEqual(['BR-QR-02', 'BAD_SIGNATURE']);
    expect(await reason(await qr(1))).toEqual(['BR-QR-03', 'OLD_VERSION']);
    expect(await reason(await qr(2, 2))).toEqual(['BR-QR-02', 'WRONG_BRANCH']);
    expect(await reason(await qr(1, 1, 'OS-22799999999'))).toEqual(['BR-QR-02', 'UNKNOWN']);
    expect(await reason('not a qr at all')).toEqual(['BR-QR-02', 'MALFORMED']);
  });

  it('BR-QR-02: a held DO is refused at the gate with its card', async () => {
    await seedDo('ON_HOLD');
    const gate = await as({ 1: ['GATE_OPERATOR'] });
    const r = await gate.post('/api/v1/plant/scan', { qr: await qr() });
    expect(r.statusCode).toBe(422);
    expect(r.json().data).toMatchObject({
      reason: 'ON_HOLD',
      card: { holdReason: 'Re-pricing shortfall' },
    });
  });

  it('BR-GATE-01: manual lookup needs gate.manual_lookup and a reason, and is audited', async () => {
    await seedDo();
    const gate = await as({ 1: ['GATE_OPERATOR'] });
    const body = { docType: 'DO', docNo: DO_NO, reason: 'QR print torn, driver has a photocopy' };
    expect((await gate.post('/api/v1/plant/lookup', body)).statusCode).toBe(403);
    const sup = await as({ 1: ['DISPATCH_SUPERVISOR'] });
    expect((await sup.post('/api/v1/plant/lookup', { ...body, reason: 'torn' })).statusCode).toBe(
      400,
    );
    const r = await sup.post('/api/v1/plant/lookup', body);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().items).toHaveLength(1);
    expect(r.json().items[0]).toMatchObject({ doType: 'OS', doNo: DO_NO });
    const a = await t.db.read((tx) =>
      tx.one(`SELECT REASON FROM AUDIT_LOG WHERE ACTION = 'MANUAL_LOOKUP' AND ENTITY_KEY = :k`, {
        k: `1|${DO_NO}`,
      }),
    );
    expect(a.REASON).toBe(body.reason);
  });
});

describe('offline cache (BR-OFF-02)', () => {
  it('open documents with their QR signature; the tablet checks a QR without the secret; ETag', async () => {
    await seedDo();
    const gate = await as({ 1: ['GATE_OPERATOR'] });
    const r = await gate.get('/api/v1/plant/offline-cache');
    expect(r.statusCode, r.body).toBe(200);
    const cache = r.json();
    expect(cache).toMatchObject({ brnch: 1, refreshMin: 5 });
    const e = cache.entries.find((x) => x.docNo === `OS-${DO_NO}`);
    expect(e).toMatchObject({ docType: 'DO', ver: 2, status: 'ISSUED', remainingTon: '25.000' });
    expect(cache.entries.every((x) => x.sig)).toBe(true);
    // offline check on the tablet (shared code)
    expect(offlineQrCheck(await qr(), cache.entries, 1)).toMatchObject({ ok: true });
    expect(offlineQrCheck(await qr(1), cache.entries, 1).reason).toBe('OLD_VERSION');
    // unchanged → 304
    const again = await gate.get('/api/v1/plant/offline-cache', {
      headers: { 'if-none-match': r.headers.etag },
    });
    expect(again.statusCode).toBe(304);
  });
});
