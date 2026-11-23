// Delivery orders (TASKS P2-06, BR-DO-*): list/outstanding, hold/release, cancel through the
// DO_CANCEL approval with the DO ledger release, print queue, send queue. SALES_NEW, rolled back.
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

async function as(roles, brnch = 1) {
  const u = await createUser(t.db, { roles });
  const c = new Client(t.app);
  await c.login(u.usrid, u.password, { brnch });
  return c;
}
const ifm = (v) => ({ 'if-match': `"${v}"` });
const CUST = '912-351';
const DO_NO = '22799000001';

/** A new-system DO (as OC confirm writes it) with its DO-ledger debit. */
async function seedDo() {
  await t.db.withTx(async (tx) => {
    await tx.exec(
      `INSERT INTO DELIVERY_ORDER (DEL_ORDER_NO, DO_TYPE, BRNCH, COMPC, YEAR, CUSTOMER_CODE, ORDER_NO,
         SR_NO, ORDER_DATE, SCHED_DATE, DO_QUANTITY, QTY_TYPE, NO_OF_BAGS, CANCEL_CODE, POST, DOC_STATUS,
         ROW_VER, DO_RATE, DO_VALUE, PRICE_CODE, PRODUCT_CODE, DISPATCHED_TON, QR_VER, CREATED_BY, CREATED_ON)
       VALUES (:n, 'OS', 1, 1, 2027, :c, 227000758, 1, :d, :d, 35, 'BAGS', 700, 'N', 'N', 'ISSUED', 1,
         24400, 854000, 'MRMOSDDU03', 'OPC', 10, 1, 'test', :d)`,
      { n: DO_NO, c: CUST, d: new Date('2026-11-23T00:00:00+05:00') },
    );
    await ledger.post(tx, { usrid: 'test', now: t.clock.now() }, [
      {
        brnch: 1,
        customerCode: CUST,
        ledgerType: 'DO',
        entryDate: '2026-11-23',
        docType: 'DO',
        docYear: 2027,
        docNo: DO_NO,
        entryKind: 'ISSUE',
        narration: 'DO # test',
        debit: '854000',
      },
    ]);
  });
}
const doLedger = () =>
  t.db.read((tx) => ledger.balance(tx, { brnch: 1, customerCode: CUST, ledgerType: 'DO' }));

describe('DO (P2-06)', () => {
  it('outstanding list, hold/release, cancel through DO_CANCEL approval releases the undispatched value', async () => {
    await seedDo();
    const fin = await as({ 1: ['FINANCE'] });
    const fm = await as({ 1: ['FINANCE_MANAGER'] });
    const base = `/api/v1/do/1/OS/${DO_NO}`;

    const list = (await fin.get(`/api/v1/do?outstanding=true&customer=${CUST}`)).json();
    expect(list.items.find((d) => d.doNo === DO_NO)).toMatchObject({
      status: 'ISSUED',
      remainingTon: '25.000',
      dispatchedTon: '10.000',
    });

    let d = (await fin.get(base)).json();
    d = (
      await fin.post(
        `${base}/hold`,
        { reason: 'Rate increased; shortfall to collect', shortfall: '50000' },
        { headers: ifm(d.rowVer) },
      )
    ).json();
    expect(d).toMatchObject({ status: 'ON_HOLD', holdShortfall: '50000.00' });
    d = (await fin.post(`${base}/release`, {}, { headers: ifm(d.rowVer) })).json();
    expect(d).toMatchObject({ status: 'PARTLY_DISPATCHED', holdReason: null });

    // BR-DO-05 with the DO_CANCEL rule: request, then the Finance Manager approves
    const req = await fin.post(
      `${base}/cancel`,
      { reason: 'Customer cancelled the remaining quantity' },
      { headers: ifm(d.rowVer) },
    );
    expect(req.statusCode, req.body).toBe(200);
    expect(req.json()).toMatchObject({ requestId: expect.any(Number), released: null });
    expect(await doLedger()).toBe('854000.00');
    const ok = await fm.post(`/api/v1/approvals/${req.json().requestId}/approve`, {});
    expect(ok.statusCode, ok.body).toBe(200);
    d = (await fin.get(base)).json();
    expect(d).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Customer cancelled the remaining quantity',
    });
    // 25 t undispatched × 24,400 = 610,000 back to the DO ledger
    expect(await doLedger()).toBe('244000.00');
    // P2-08: order cancellation advice for the cancelled quantity
    const adv = (await fin.get('/api/v1/cancellations?kind=order&pageSize=3')).json();
    expect(adv.items[0]).toMatchObject({
      kind: 'ORDER',
      customerCode: CUST,
      amount: '610000.00',
      qtyTon: '25.00',
      lines: 1,
    });
  });

  it('print and send are queued; branch scope', async () => {
    await seedDo();
    const fin = await as({ 1: ['FINANCE'] });
    const base = `/api/v1/do/1/OS/${DO_NO}`;
    const pr = await fin.post(`${base}/print`, {});
    expect(pr.statusCode, pr.body).toBe(202);
    expect(pr.json().entityKey).toBe(`1|OS|${DO_NO}`);
    const send = await fin.post(`${base}/send`, { channels: ['SMS', 'WHATSAPP'] });
    expect(send.statusCode, send.body).toBe(200);
    expect(send.json().outboxIds).toHaveLength(2);
    expect((await fin.get(base)).json().sentToDealerOn).toBeTruthy();
    expect((await fin.get('/api/v1/do?brnch=2')).statusCode).toBe(403);
    expect((await fin.get('/api/v1/do/1/OS/1')).statusCode).toBe(404);
  });
});

describe('re-pricing (P2-07)', () => {
  it('BR-PRC-07/08: only DOs past the rate lock; a shortfall puts the DO on hold', async () => {
    await seedDo();
    // lock of the seeded DO ends 2026-12-07 (issue + 14 days)
    await t.db.withTx((tx) =>
      tx.exec(
        'UPDATE DELIVERY_ORDER SET RATE_LOCK_UNTIL = :d WHERE BRNCH = 1 AND DEL_ORDER_NO = :n',
        {
          d: new Date('2026-12-07T00:00:00+05:00'),
          n: DO_NO,
        },
      ),
    );
    const sm = await as({ 1: ['SALES_MANAGER'] });
    const body = {
      productCode: 'OPC',
      customerCode: CUST,
      newRate: '25400',
      effectiveFrom: '2026-12-01',
    };
    let r = await sm.post('/api/v1/reprice/preview', body);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().lines).toHaveLength(0); // still locked on 1 Dec

    r = await sm.post('/api/v1/reprice/preview', { ...body, effectiveFrom: '2026-12-10' });
    const line = r.json().lines.find((l) => l.doNo === DO_NO);
    // 25 t × (25,400 − 24,400) = 25,000 extra; available is negative (DO debit, no money)
    expect(line).toMatchObject({ oldRate: '24400.00', newRate: '25400.00', extra: '25000.00' });
    expect(line.shortfall).toBe('25000.00');

    r = await sm.post('/api/v1/reprice/apply', { ...body, effectiveFrom: '2026-12-10' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().held.map((h) => h.doNo)).toContain(DO_NO);
    const d = (await sm.get(`/api/v1/do/1/OS/${DO_NO}`)).json();
    expect(d).toMatchObject({ status: 'ON_HOLD', holdShortfall: '25000.00' });
  });
});

describe('DO quantity adjustment advice (BR-DO-06)', () => {
  it('advice → DO_ADJUST approval → DO, value, bags, QR version and DO ledger change', async () => {
    await seedDo(); // 35 t, 10 t dispatched, 24,400/t
    const fin = await as({ 1: ['FINANCE'] });
    const fm = await as({ 1: ['FINANCE_MANAGER'] });
    const base = `/api/v1/do/1/OS/${DO_NO}`;
    let d = (await fin.get(base)).json();

    // BR-DO-04: never below what was dispatched
    let r = await fin.post(
      `${base}/adjust`,
      { qtyTon: '5', reason: 'Customer reduced the order' },
      { headers: ifm(d.rowVer) },
    );
    expect(r.statusCode).toBe(422);
    expect(r.json().ruleId).toBe('BR-DO-04');
    // an increase needs the available balance (BR-BAL-03 shortfall)
    r = await fin.post(
      `${base}/adjust`,
      { qtyTon: '100000', reason: 'Customer wants much more cement' },
      { headers: ifm(d.rowVer) },
    );
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({
      ruleId: 'BR-BAL-03',
      data: { shortfall: expect.any(String) },
    });

    // reduction 35 → 30 t: advice pending, DO unchanged until approved
    r = await fin.post(
      `${base}/adjust`,
      { qtyTon: '30', reason: 'Customer reduced the order by 5 t' },
      { headers: ifm(d.rowVer) },
    );
    expect(r.statusCode, r.body).toBe(200);
    const { advice, requestId } = r.json();
    expect(advice).toMatchObject({
      status: 'PENDING_APPROVAL',
      deltaTon: '-5.000',
      deltaValue: '-122000.00',
      doNo: DO_NO,
      reason: 'Customer reduced the order by 5 t',
    });
    expect(requestId).toEqual(expect.any(Number));
    expect(r.json().do.qtyTon).toBe('35.000');
    // one pending advice per DO
    r = await fin.post(
      `${base}/adjust`,
      { qtyTon: '32', reason: 'Another change of quantity' },
      { headers: ifm(d.rowVer) },
    );
    expect(r.statusCode).toBe(409);

    const ok = await fm.post(`/api/v1/approvals/${requestId}/approve`, {});
    expect(ok.statusCode, ok.body).toBe(200);
    d = (await fin.get(base)).json();
    expect(d).toMatchObject({
      qtyTon: '30.000',
      value: '732000.00',
      bags: 600,
      qrVer: 2, // BR-QR-03: the old print is no longer valid
      status: 'ISSUED',
    });
    expect(await doLedger()).toBe('732000.00'); // Cr 122,000 (DOA)

    // rejected advice leaves the DO as it is
    r = await fin.post(
      `${base}/adjust`,
      { qtyTon: '20', reason: 'Customer may reduce again' },
      { headers: ifm(d.rowVer) },
    );
    expect(r.statusCode, r.body).toBe(200);
    const rej = await fm.post(`/api/v1/approvals/${r.json().requestId}/reject`, {
      comment: 'Customer confirmed 30 t by phone',
    });
    expect(rej.statusCode, rej.body).toBe(200);
    expect((await fin.get(base)).json().qtyTon).toBe('30.000');

    const list = (await fin.get(`/api/v1/do-adjustments?doNo=${DO_NO}`)).json();
    expect(list.items.map((a) => [a.status, a.deltaTon])).toEqual([
      ['REJECTED', '-10.000'],
      ['APPROVED', '-5.000'],
    ]);
    expect(list.items[1].authorisedBy).toBeTruthy();
    expect((await fin.get('/api/v1/do-adjustments?brnch=2')).statusCode).toBe(403);
  });
});

describe('DO adjustment without an active DO_ADJUST rule', () => {
  it('BR-DO-06: the advice is applied at once and recorded as approved', async () => {
    await seedDo();
    await t.db.withTx((tx) =>
      tx.exec("UPDATE APPROVAL_RULE SET ACTIVE = 'N' WHERE DOC_TYPE = 'DO_ADJUST'"),
    );
    const fin = await as({ 1: ['FINANCE'] });
    const base = `/api/v1/do/1/OS/${DO_NO}`;
    const d = (await fin.get(base)).json();
    const r = await fin.post(
      `${base}/adjust`,
      { qtyTon: '34', reason: 'One tonne short in the order' },
      { headers: ifm(d.rowVer) },
    );
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      requestId: null,
      advice: { status: 'APPROVED', deltaValue: '-24400.00' },
      do: { qtyTon: '34.000', value: '829600.00' },
    });
    expect(await doLedger()).toBe('829600.00');
  });
});
