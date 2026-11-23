// City-wise permits (TASKS P2-05, BR-PMT-*): rates from the sheet, issue with balance check and
// override, adjust, cancel, CFO route. SALES_NEW, rolled back.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, buildTestApp, createUser } from '../../../test/helpers/app.js';
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

async function as(roles, brnch = 2) {
  const u = await createUser(t.db, { roles });
  const c = new Client(t.app);
  await c.login(u.usrid, u.password, { brnch });
  return c;
}
const ifm = (v) => ({ 'if-match': `"${v}"` });
const CUST = '1502-22-080';
const doLedger = () =>
  t.db.read((tx) => ledger.balance(tx, { brnch: 2, customerCode: CUST, ledgerType: 'DO' }));
const body = (areas) => ({
  brnch: 2,
  permitDate: '2026-11-23',
  customerCode: CUST,
  productCode: 'OPS',
  areas,
});

describe('permits (P2-05)', () => {
  it('rates from the sheet, issue blocked when short, override, issue, adjust, cancel', async () => {
    const fin = await as({ 2: ['FINANCE'] });
    const cfo = await as({ 2: ['CFO'] });

    const rates = (await fin.get('/api/v1/permits/city-rates?product=OPS&date=2026-11-23')).json();
    expect(rates.lines.find((l) => l.areaDoc === '2190')).toMatchObject({ rate: '25070.00' });

    // 5,000 t is far above any balance of this customer
    const res = await fin.post(
      '/api/v1/permits',
      body([
        { areaDoc: '2190', qtyTon: '5000' },
        { areaDoc: '2196', qtyTon: '20', rate: '25000' },
      ]),
    );
    expect(res.statusCode, res.body).toBe(201);
    let p = res.json();
    expect(p).toMatchObject({
      status: 'DRAFT',
      qtyTon: '5020.000',
      value: '125850000.00',
      validTo: null,
    });
    expect(p.permitNo).toMatch(/^\d+\.2$/); // BR-PMT-08
    expect(p.areas.map((a) => [a.areaDoc, a.rate, a.rateOverride])).toEqual([
      ['2190', '25070.00', false],
      ['2196', '25000.00', true],
    ]);
    const base = `/api/v1/permits/2/${p.permitNo}`;

    let r = await fin.post(`${base}/issue`, {}, { headers: ifm(p.rowVer) });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ ruleId: 'BR-PMT-02', data: { value: '125850000.00' } });

    r = await fin.post(`${base}/request-override`, {
      reason: 'Government project, CFO agreed by phone',
    });
    expect(r.statusCode, r.body).toBe(200);
    expect((await cfo.post(`/api/v1/approvals/${r.json().requestId}/approve`, {})).statusCode).toBe(
      200,
    );
    p = (await fin.get(base)).json();
    r = await fin.post(`${base}/issue`, {}, { headers: ifm(p.rowVer) });
    expect(r.statusCode, r.body).toBe(200);
    p = r.json().permit;
    expect(p).toMatchObject({ status: 'ISSUED', validFrom: '2026-11-23', validTo: null });
    expect(await doLedger()).toBe('125850000.00');
    const bal = (await fin.get(`/api/v1/customers/2/${CUST}/balance`)).json();
    expect(bal.commitments.filter((c) => c.kind === 'PERMIT')).toHaveLength(2);

    // BR-NTF-01: send / resend to the dealer on the chosen channels
    await t.db.withTx((tx) =>
      tx.exec(
        `UPDATE CUSTOMER_INFO SET MOBILE_NO = '03001234567' WHERE BRNCH = 2 AND CUSTOMER_CODE = :c`,
        { c: CUST },
      ),
    );
    r = await fin.post(`${base}/send`, { channels: ['SMS'] });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().outboxIds).toHaveLength(1);
    const sms = await t.db.read((tx) =>
      tx.one('SELECT RECIPIENT, PAYLOAD FROM NOTIFICATION_OUTBOX WHERE OUTBOX_ID = :i', {
        i: r.json().outboxIds[0],
      }),
    );
    expect(sms.RECIPIENT).toBe('03001234567');
    expect(JSON.parse(sms.PAYLOAD).text).toContain(p.permitNo);
    p = (await fin.get(base)).json();
    expect(p.sentToDealerOn).toBeTruthy();

    // BR-PMT-06: reduce 2190 by 1,000 t → credit 25,070,000 and an adjustment row
    const line = p.areas.find((a) => a.areaDoc === '2190');
    r = await fin.post(
      `${base}/adjust`,
      { lines: [{ lnkno: line.lnkno, qtyTon: '4000' }], reason: 'Customer reduced the booking' },
      { headers: ifm(p.rowVer) },
    );
    expect(r.statusCode, r.body).toBe(200);
    p = r.json();
    expect(p).toMatchObject({ qtyTon: '4020.000', value: '100780000.00', qrVer: 2 }); // BR-QR-03 reprint
    expect(p.adjustments).toMatchObject([
      { areaDoc: '2190', qtyTon: '-1000.000', amount: '-25070000.00' },
    ]);
    expect(await doLedger()).toBe('100780000.00');
    // an increase needs the balance again
    r = await fin.post(
      `${base}/adjust`,
      { lines: [{ lnkno: line.lnkno, qtyTon: '9000' }], reason: 'Customer wants more cement' },
      { headers: ifm(p.rowVer) },
    );
    expect(r.json().ruleId).toBe('BR-PMT-06');

    // BR-PMT-07: cancel releases the undispatched value
    r = await fin.post(
      `${base}/cancel`,
      { reason: 'Project stopped by the client' },
      { headers: ifm(p.rowVer) },
    );
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().status).toBe('CANCELLED');
    expect(await doLedger()).toBe('0.00');
  });

  it('BR-PMT-03: send to CFO; approval returns it to DRAFT with the CFO decision recorded', async () => {
    const fin = await as({ 2: ['FINANCE'] });
    const cfo = await as({ 2: ['CFO'] });
    let p = (await fin.post('/api/v1/permits', body([{ areaDoc: '2190', qtyTon: '40' }]))).json();
    const base = `/api/v1/permits/2/${p.permitNo}`;
    const r = await fin.post(
      `${base}/send-cfo`,
      { reason: 'Large first order of this dealer' },
      { headers: ifm(p.rowVer) },
    );
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().permit.status).toBe('PENDING_CFO');
    expect((await cfo.post(`/api/v1/approvals/${r.json().requestId}/approve`, {})).statusCode).toBe(
      200,
    );
    p = (await fin.get(base)).json();
    expect(p).toMatchObject({ status: 'DRAFT', cfoReqId: r.json().requestId });
    // a draft is not sent to the dealer
    expect((await fin.post(`${base}/send`, { channels: ['SMS'] })).statusCode).toBe(409);
  });

  it('legacy permits read as issued; branch scope', async () => {
    const fin = await as({ 2: ['FINANCE'] });
    const list = (await fin.get('/api/v1/permits?pageSize=3')).json();
    expect(list.items[0]).toMatchObject({ brnch: 2 });
    const one = await fin.get(`/api/v1/permits/2/20272292.1`);
    expect(one.statusCode, one.body).toBe(200);
    expect(one.json()).toMatchObject({ status: 'ISSUED', createdBy: 'legacy' });
    expect(one.json().areas.length).toBeGreaterThan(0);
    expect((await fin.get('/api/v1/permits?brnch=1')).statusCode).toBe(403);
  });
});
