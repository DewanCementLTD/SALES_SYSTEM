// SRF (TASKS P2-01, BR-SRF-*) and the draft OC it creates (P2-02, BR-OC-01). SALES_NEW, rolled back.
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

async function as(roles, brnch = 2) {
  const u = await createUser(t.db, { roles });
  const c = new Client(t.app);
  await c.login(u.usrid, u.password, { brnch });
  return c;
}

// Hattar customer with an approved trade price ABABDOPS18 (OPS, city 2172, invoice price 25,700)
const body = (o = {}) => ({
  brnch: 2,
  srfDate: '2026-11-23',
  customerCode: '1210-21-001',
  productCode: 'OPS',
  destGeoCode: 'Z12-T12-A01-C2172',
  bagCode: 101,
  qtyTon: '40',
  bags: 800,
  modeOfDelivery: 'BAGS',
  modeOfTransport: '001',
  schedule: [
    { srNo: 1, date: '2026-11-24', qtyTon: '20' },
    { srNo: 2, date: '2026-11-26', qtyTon: '20' },
  ],
  ...o,
});
const ifm = (v) => ({ 'if-match': `"${v}"` });

describe('SRF (P2-01)', () => {
  it('create → edit → submit creates exactly one draft OC priced from the trade price', async () => {
    const mk = await as({ 2: ['MARKETING'] });
    const res = await mk.post('/api/v1/srf', body());
    expect(res.statusCode, res.body).toBe(201);
    const srf = res.json();
    expect(srf).toMatchObject({
      status: 'DRAFT',
      qtyTon: '40.00',
      contractValidTo: '2027-02-23', // BR-SRF-07: + 3 months
      destName: expect.any(String),
      schedule: [
        { srNo: 1, qtyTon: '20.00' },
        { srNo: 2, qtyTon: '20.00' },
      ],
    });
    expect(BigInt(srf.srfNo)).toBeGreaterThan(66461226n); // continues the legacy series
    // BR-SRF-04: tax fields default from the customer; DO handover defaults to the customer name
    expect(srf.doHandoverTo).toBe(srf.customerName);

    const base = `/api/v1/srf/2/${srf.srfNo}`;
    const upd = await mk.put(
      base,
      body({
        brnch: undefined,
        qtyTon: '30',
        bags: 600,
        schedule: [{ srNo: 1, date: '2026-11-24', qtyTon: '30' }],
      }),
      { headers: ifm(srf.rowVer) },
    );
    expect(upd.statusCode, upd.body).toBe(200);
    expect(upd.json().schedule).toEqual([{ srNo: 1, date: '2026-11-24', qtyTon: '30.00' }]);
    expect(
      (await mk.put(base, body({ brnch: undefined }), { headers: ifm(srf.rowVer) })).statusCode,
    ).toBe(409);

    const sub = await mk.post(`${base}/submit`, {}, { headers: ifm(upd.json().rowVer) });
    expect(sub.statusCode, sub.body).toBe(200);
    expect(sub.json().srf).toMatchObject({ status: 'SUBMITTED', ocNo: sub.json().oc.ocNo });
    expect(sub.json().oc).toMatchObject({
      priced: true,
      priceCode: 'ABABDOPS18',
      value: '771000.00', // 25,700 × 30 t (BR-OC-03)
    });
    const oc = await t.db.read((tx) =>
      tx.one(
        `SELECT DOC_STATUS, CONS_PRICE, NET_BOOK_PRICE, TOT_NET, PRICE_OVERRIDE, MASTER_PRICES,
                (SELECT COUNT(*) FROM ORDER_CONFIRM_DETAIL d WHERE d.BRNCH = o.BRNCH AND d.ORDER_NO = o.ORDER_NO) AS LINES
           FROM ORDER_CONFIRM o WHERE BRNCH = 2 AND ORDER_NO = :n`,
        { n: sub.json().oc.ocNo },
      ),
    );
    expect(oc).toMatchObject({
      DOC_STATUS: 'DRAFT',
      CONS_PRICE: '25700',
      TOT_NET: '771000',
      LINES: 1,
    });
    expect(JSON.parse(oc.MASTER_PRICES)).toMatchObject({ consPrice: '25700.00' });

    // BR-SRF-05: one SRF → one OC
    const again = await mk.post(`${base}/submit`, {}, { headers: ifm(sub.json().srf.rowVer) });
    expect(again.json().code).toBe('invalid_state');
    // a submitted SRF is no longer editable
    expect(
      (
        await mk.put(base, body({ brnch: undefined }), { headers: ifm(sub.json().srf.rowVer) })
      ).json().code,
    ).toBe('invalid_state');

    // BR-SRF-06: cancelling the SRF cancels the draft OC
    const cx = await mk.post(
      `${base}/cancel`,
      { reason: 'Customer withdrew the order' },
      { headers: ifm(sub.json().srf.rowVer) },
    );
    expect(cx.statusCode, cx.body).toBe(200);
    expect(cx.json()).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Customer withdrew the order',
    });
    const ocAfter = await t.db.read((tx) =>
      tx.one(
        'SELECT DOC_STATUS, CANCEL_CODE FROM ORDER_CONFIRM WHERE BRNCH = 2 AND ORDER_NO = :n',
        {
          n: sub.json().oc.ocNo,
        },
      ),
    );
    expect(ocAfter).toEqual({ DOC_STATUS: 'CANCELLED', CANCEL_CODE: 'Y' });
  });

  it('BR-SRF-02/03: schedule must add up; export needs P.I./Form-E/L.C.', async () => {
    const mk = await as({ 2: ['MARKETING'] });
    const bad = await mk.post(
      '/api/v1/srf',
      body({ schedule: [{ srNo: 1, date: '2026-11-24', qtyTon: '10' }] }),
    );
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toMatch(/BR-SRF-02/);
    const exp = await mk.post('/api/v1/srf', body({ localExport: 'E' }));
    expect(exp.statusCode).toBe(400);
    expect(exp.body).toMatch(/Form-E is required/);
  });

  it('references are checked: destination, product; an SRF without a trade price gets an unpriced OC', async () => {
    const mk = await as({ 2: ['MARKETING'] });
    const geo = await mk.post('/api/v1/srf', body({ destGeoCode: 'Z99-NOPE' }));
    expect(geo.statusCode).toBe(400);
    expect(geo.body).toMatch(/destination/);
    // a priced customer at a city without a trade price → OC built with zero prices
    const other = await t.db.read((tx) =>
      tx.one(
        `SELECT GEO_CODE FROM GEO_HIERARCHY WHERE BRNCH = 2 AND GEO_LEVEL = 4 AND NVL(ACTIVE, 'Y') = 'Y'
           AND GEO_CODE <> 'Z12-T12-A01-C2172' AND ROWNUM = 1`,
      ),
    );
    const res = await mk.post('/api/v1/srf', body({ destGeoCode: other.GEO_CODE }));
    expect(res.statusCode, res.body).toBe(201);
    const sub = await mk.post(
      `/api/v1/srf/2/${res.json().srfNo}/submit`,
      {},
      { headers: ifm(res.json().rowVer) },
    );
    expect(sub.json().oc).toMatchObject({ priced: false, value: '0.00' });
  });

  it('branch scope: list and create only in my branches', async () => {
    const mk = await as({ 2: ['MARKETING'] });
    const list = await mk.get('/api/v1/srf?pageSize=5');
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().items.every((s) => s.brnch === 2)).toBe(true);
    expect(list.json().items[0]).toMatchObject({ status: expect.any(String) });
    expect((await mk.get('/api/v1/srf?brnch=1')).statusCode).toBe(403);
    expect((await mk.post('/api/v1/srf', body({ brnch: 1 }))).statusCode).toBe(403);
    expect((await mk.get('/api/v1/srf/1/21653339')).statusCode).toBe(403);
  });
});

describe('Contract Review print (BR-SRF-07)', () => {
  it('queues the PDF job with the SRF data; files are listed per document', async () => {
    const mk = await as({ 2: ['MARKETING'] });
    const srf = (await mk.post('/api/v1/srf', body())).json();
    const res = await mk.post(`/api/v1/srf/2/${srf.srfNo}/contract-review`, {});
    expect(res.statusCode, res.body).toBe(202);
    const job = await t.db.read((tx) =>
      tx.one('SELECT EVENT_TYPE, PAYLOAD FROM NOTIFICATION_OUTBOX WHERE OUTBOX_ID = :id', {
        id: res.json().outboxId,
      }),
    );
    expect(job.EVENT_TYPE).toBe('PDF_RENDER');
    const payload = JSON.parse(job.PAYLOAD);
    expect(payload).toMatchObject({
      template: 'contract-review',
      entity: 'SALES_REQUEST_MASTER',
      entityKey: `2|${srf.srfNo}`,
      data: { srf: { srfNo: srf.srfNo, contractValidTo: '2027-02-23' } },
    });
    const files = await mk.get(
      `/api/v1/files?entity=SALES_REQUEST_MASTER&key=${encodeURIComponent(`2|${srf.srfNo}`)}`,
    );
    expect(files.statusCode, files.body).toBe(200);
    expect(files.json().items).toEqual([]);
    expect(
      (await mk.get('/api/v1/files?entity=SALES_REQUEST_MASTER&key=1%7C21653339')).statusCode,
    ).toBe(403);
  });
});
