// OC life cycle (TASKS P2-03, BR-OC-*, BR-BAL-*): edit + price override, review/approve,
// BRV links, confirm with balance check and DOs, balance override, cancel. SALES_NEW, rolled back.
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, buildTestApp, createUser } from '../../../test/helpers/app.js';
import { closeTestDb, getTestDb } from '../../../test/helpers/db.js';
import * as balance from '../ledger/balance.js';
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
afterAll(closeTestDb);

async function as(roles, brnch = 2) {
  const u = await createUser(t.db, { roles });
  const c = new Client(t.app);
  await c.login(u.usrid, u.password, { brnch });
  return c;
}
const ifm = (v) => ({ 'if-match': `"${v}"` });
const CUST = '1210-21-001'; // Hattar, trade price ABABDOPS18 (OPS, city 2172, 25,700), no credit

/** SRF → submit → draft OC. */
async function draftOc(mk) {
  const srf = (
    await mk.post('/api/v1/srf', {
      brnch: 2,
      srfDate: '2026-11-23',
      customerCode: CUST,
      productCode: 'OPS',
      destGeoCode: 'Z12-T12-A01-C2172',
      qtyTon: '40',
      modeOfDelivery: 'BAGS',
      modeOfTransport: '001',
      schedule: [
        { srNo: 1, date: '2026-11-24', qtyTon: '25' },
        { srNo: 2, date: '2026-11-26', qtyTon: '15' },
      ],
    })
  ).json();
  const sub = await mk.post(`/api/v1/srf/2/${srf.srfNo}/submit`, {}, { headers: ifm(srf.rowVer) });
  expect(sub.statusCode, sub.body).toBe(200);
  return { srfNo: srf.srfNo, ocNo: sub.json().oc.ocNo };
}

describe('OC (P2-03)', () => {
  it('full cycle: override, review, approve, shortfall, BRV, balance override, confirm, cancel', async () => {
    const mk = await as({ 2: ['MARKETING'] });
    const fin = await as({ 2: ['FINANCE'] });
    const fin2 = await as({ 2: ['FINANCE'] });
    const sm = await as({ 2: ['SALES_MANAGER'] });
    const sm2 = await as({ 2: ['SALES_MANAGER'] });
    const cfo = await as({ 2: ['CFO'] });
    const { srfNo, ocNo } = await draftOc(mk);
    const base = `/api/v1/oc/2/${ocNo}`;

    let oc = (await fin.get(base)).json();
    expect(oc).toMatchObject({
      status: 'DRAFT',
      value: '1028000.00',
      priceOverride: 'N',
      prices: { consPrice: '25700.00' },
      masterPrices: { priceCode: 'ABABDOPS18' },
    });
    expect(oc.doTypes.length).toBeGreaterThan(0);
    const doType = oc.doTypes[0].value;

    // BR-OC-02: a price below the trade price is an override that needs approval
    const prices = { ...oc.prices, discount: '200' };
    let res = await fin.put(
      base,
      { qtyTon: '40', prices, schedule: oc.schedule, remarks: 'Special rate' },
      { headers: ifm(oc.rowVer) },
    );
    expect(res.statusCode, res.body).toBe(200);
    oc = res.json();
    expect(oc).toMatchObject({ priceOverride: 'Y', netPrice: '25500.00', value: '1020000.00' });
    const preview = await fin.post(`${base}/price-preview`, { prices: oc.masterPrices });
    expect(preview.json()).toMatchObject({ overridden: [], value: '1028000.00' });

    oc = (await fin.post(`${base}/review`, {}, { headers: ifm(oc.rowVer) })).json();
    expect(oc.status).toBe('REVIEWED');
    res = await fin2.post(`${base}/approve`, {}, { headers: ifm(oc.rowVer) });
    expect(res.json().code).toBe('approval_required');

    const po = await sm.post(`${base}/request-override`, {
      kind: 'PRICE',
      reason: 'Matching competitor rate for this project',
    });
    expect(po.statusCode, po.body).toBe(200);
    expect(
      (await sm.post(`/api/v1/approvals/${po.json().requestId}/approve`, {})).json().code,
    ).toBe('maker_checker');
    expect(
      (await sm2.post(`/api/v1/approvals/${po.json().requestId}/approve`, {})).statusCode,
    ).toBe(200);
    oc = (await fin.get(base)).json();
    expect(oc.priceOverride).toBe('A');

    oc = (await fin2.post(`${base}/approve`, {}, { headers: ifm(oc.rowVer) })).json();
    expect(oc).toMatchObject({ status: 'APPROVED', approvedBy: expect.any(String) });

    // BR-OC-06: no money yet → shortfall = value
    res = await fin.post(`${base}/confirm`, { doType }, { headers: ifm(oc.rowVer) });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      ruleId: 'BR-OC-06',
      data: { shortfall: '1020000.00', available: '0.00' },
    });

    // a verified BRV raises the balance; link it (BR-OC-05)
    const brv = (
      await fin.post('/api/v1/brv', {
        brnch: 2,
        brvDate: '2026-11-23',
        customerCode: CUST,
        instCode: 'K',
        depositAccount: (
          await t.db.read((tx) =>
            tx.one(
              "SELECT BANK_CODE FROM COMPANY_BANK WHERE BRNCH = 2 AND NVL(ACTIVE, 'Y') = 'Y' AND ROWNUM = 1",
            ),
          )
        ).BANK_CODE,
        amount: '600000',
      })
    ).json();
    const ver = await fin2.post(
      `/api/v1/brv/2/${brv.receiptNo}/verify`,
      { method: 'BANK_PORTAL', bankRef: 'Portal 23-11' },
      { headers: ifm(brv.rowVer) },
    );
    expect(ver.statusCode, ver.body).toBe(200);
    oc = (await fin.get(base)).json();
    expect(oc.linkableBrvs.map((b) => b.receiptNo)).toContain(brv.receiptNo);
    const over = await fin.put(
      `${base}/brvs`,
      { links: [{ receiptNo: brv.receiptNo, amount: '700000' }] },
      { headers: ifm(oc.rowVer) },
    );
    expect(over.json()).toMatchObject({ ruleId: 'BR-OC-05' });
    oc = (
      await fin.put(
        `${base}/brvs`,
        { links: [{ receiptNo: brv.receiptNo, amount: '600000' }] },
        { headers: ifm(oc.rowVer) },
      )
    ).json();
    expect(oc.brvs).toMatchObject([{ receiptNo: brv.receiptNo, amount: '600000.00' }]);

    const bal = (await fin.get(`${base}/balance`)).json();
    expect(bal).toMatchObject({ available: '600000.00', shortfall: '420000.00' });

    // BR-BAL-04: balance override approved by the CFO covers the shortfall
    const bo = await fin.post(`${base}/request-override`, {
      kind: 'BALANCE',
      reason: 'Customer pays the rest on delivery, CFO informed',
    });
    expect(bo.statusCode, bo.body).toBe(200);
    expect(
      (await cfo.post(`/api/v1/approvals/${bo.json().requestId}/approve`, {})).statusCode,
    ).toBe(200);
    oc = (await fin.get(base)).json();
    expect(oc.overrideReqId).toBe(bo.json().requestId);

    // BR-OC-07: confirm creates one DO per schedule line and debits the DO ledger
    res = await fin.post(`${base}/confirm`, { doType }, { headers: ifm(oc.rowVer) });
    expect(res.statusCode, res.body).toBe(200);
    const conf = res.json();
    expect(conf.oc.status).toBe('CONFIRMED');
    expect(conf.dos.map((d) => [d.srNo, d.qtyTon, d.value])).toEqual([
      [1, '25.000', '637500.00'],
      [2, '15.000', '382500.00'],
    ]);
    expect(conf.balanceAfter).toBe('-420000.00');
    const doLedger = await t.db.read((tx) =>
      ledger.balance(tx, { brnch: 2, customerCode: CUST, ledgerType: 'DO' }),
    );
    expect(doLedger).toBe('420000.00'); // 1,020,000 issued − 600,000 received
    const after = (await fin.get(`/api/v1/customers/2/${CUST}/balance`)).json();
    expect(after).toMatchObject({ openCommitments: '1020000.00', available: '-420000.00' });
    expect(after.commitments).toHaveLength(2);
    const srf = (await mk.get(`/api/v1/srf/2/${srfNo}`)).json();
    expect(srf.status).toBe('CONVERTED');
    expect((await fin.get(base)).json().dos.every((d) => d.status === 'ISSUED')).toBe(true);

    // BR-OC-08: cancel → DOs cancelled, their value released in the DO ledger
    oc = (await fin.get(base)).json();
    const cx = await fin.post(
      `${base}/cancel`,
      { reason: 'Project postponed by the customer' },
      { headers: ifm(oc.rowVer) },
    );
    expect(cx.statusCode, cx.body).toBe(200);
    expect(cx.json().status).toBe('CANCELLED');
    expect(cx.json().dos.every((d) => d.status === 'CANCELLED')).toBe(true);
    expect(
      await t.db.read((tx) =>
        ledger.balance(tx, { brnch: 2, customerCode: CUST, ledgerType: 'DO' }),
      ),
    ).toBe('-600000.00');
    expect((await fin.get(`/api/v1/customers/2/${CUST}/balance`)).json().available).toBe(
      '600000.00',
    );
  });

  it('reject returns to DRAFT; duplicate makes a new DRAFT; branch scope', async () => {
    const mk = await as({ 2: ['MARKETING'] });
    const fin = await as({ 2: ['FINANCE'] });
    const { ocNo } = await draftOc(mk);
    const base = `/api/v1/oc/2/${ocNo}`;
    let oc = (await fin.get(base)).json();
    oc = (await fin.post(`${base}/review`, {}, { headers: ifm(oc.rowVer) })).json();
    const rej = await fin.post(
      `${base}/reject`,
      { reason: 'Quantity to be checked with the customer' },
      { headers: ifm(oc.rowVer) },
    );
    expect(rej.json()).toMatchObject({ status: 'DRAFT', reviewedBy: null });
    const dup = await fin.post(`${base}/duplicate`, {});
    expect(dup.statusCode, dup.body).toBe(200);
    expect(dup.json()).toMatchObject({ status: 'DRAFT', value: '1028000.00' });
    expect(dup.json().ocNo).not.toBe(ocNo);
    expect(dup.json().schedule).toHaveLength(2);

    // BR-OC-03: the print is queued with the breakdown and the OC_TERMS paragraphs
    const pr = await fin.post(`${base}/print`, {});
    expect(pr.statusCode, pr.body).toBe(202);
    expect(pr.json().entityKey).toBe(`2|${ocNo}`);
    const job = await t.db.read((tx) =>
      tx.one('SELECT PAYLOAD FROM NOTIFICATION_OUTBOX WHERE OUTBOX_ID = :i', {
        i: pr.json().outboxId,
      }),
    );
    const payload = JSON.parse(job.PAYLOAD);
    expect(payload.template).toBe('order-confirmation');
    expect(payload.data.breakdown).toMatchObject({ netPrice: '25700.00', value: '1028000.00' });
    expect(payload.data.overridden).toEqual([]);
    expect(Array.isArray(payload.data.terms)).toBe(true);

    expect((await fin.get('/api/v1/oc?brnch=1')).statusCode).toBe(403);
    const list = (await fin.get('/api/v1/oc?pageSize=5')).json();
    expect(list.items.every((o) => o.brnch === 2)).toBe(true);
  });
});

describe('BR-BAL-02: confirmations on the same customer are serialised', () => {
  it('two transactions that lock the customer never overlap', async () => {
    const db = await getTestDb();
    const windows = await Promise.all(
      [0, 1, 2, 3].map((i) =>
        db.withTx(
          async (tx) => {
            await balance.lockCustomer(tx, 2, CUST);
            const start = process.hrtime.bigint();
            await sleep(30);
            return { i, start, end: process.hrtime.bigint() };
          },
          { usrid: 'vitest', action: 'oc-lock', rollback: true },
        ),
      ),
    );
    windows.sort((a, b) => (a.start < b.start ? -1 : 1));
    for (let k = 1; k < windows.length; k += 1)
      expect(windows[k].start >= windows[k - 1].end, `overlap at ${k}`).toBe(true);
  });
});
