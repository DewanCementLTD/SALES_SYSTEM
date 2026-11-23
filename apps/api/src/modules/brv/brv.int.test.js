// BRV entry, verification (ledger), clearing, bounce, cancel (TASKS P2-04, BR-BRV-*).
// SALES_NEW, rolled back.
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
const CUST = '102-04';
const body = (o = {}) => ({
  brnch: 1,
  brvDate: '2026-11-23',
  customerCode: CUST,
  instCode: 'N',
  category: 'A',
  chequeNo: 'IBFT-7781',
  depositAccount: 'HBL',
  amount: '500000',
  remarks: 'Advance for OPC',
  ...o,
});
const ifm = (v) => ({ 'if-match': `"${v}"` });
const dcBalance = () =>
  t.db.read((tx) => ledger.balance(tx, { brnch: 1, customerCode: CUST, ledgerType: 'DC' }));

describe('BRV (P2-04)', () => {
  it('BR-BRV-03/04: entered BRVs do not count; verification by another user credits both ledgers', async () => {
    const maker = await as({ 1: ['FINANCE'] });
    const res = await maker.post('/api/v1/brv', body());
    expect(res.statusCode, res.body).toBe(201);
    const brv = res.json();
    expect(brv).toMatchObject({ status: 'ENTERED', amount: '500000.00', depositShort: 'HBL' });
    expect(BigInt(brv.receiptNo)).toBeGreaterThan(2026100011n);
    expect(await dcBalance()).toBe('0.00');

    const base = `/api/v1/brv/1/${brv.receiptNo}`;
    const edited = await maker.put(base, body({ brnch: undefined, amount: '600000' }), {
      headers: ifm(brv.rowVer),
    });
    expect(edited.statusCode, edited.body).toBe(200);

    // queue shows it, oldest first
    const checker = await as({ 1: ['FINANCE'] });
    const queue = (await checker.get('/api/v1/brv/verification-queue?pageSize=200')).json();
    expect(queue.items.some((b) => b.receiptNo === brv.receiptNo)).toBe(true);

    const verify = { method: 'PHONE', bankRef: 'HBL call 10:30', remarks: 'Confirmed by branch' };
    const own = await maker.post(`${base}/verify`, verify, { headers: ifm(edited.json().rowVer) });
    expect(own.json()).toMatchObject({ code: 'maker_checker', ruleId: 'BR-BRV-03' });

    const ok = await checker.post(`${base}/verify`, verify, { headers: ifm(edited.json().rowVer) });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'VERIFIED', verifyMethod: 'PHONE' });
    expect(await dcBalance()).toBe('-600000.00');
    const rows = await t.db.read((tx) =>
      ledger.documentRows(tx, { brnch: 1, docType: 'BRV', docNo: brv.receiptNo, docYear: 2027 }),
    );
    expect(rows.map((r) => [r.ledgerType, r.credit])).toEqual([
      ['DO', '600000.00'],
      ['DC', '600000.00'],
    ]);
    expect(rows[0].narration).toMatch(
      new RegExp(`^BRV # ${brv.receiptNo} · ONLINE TRANSFER · HBL`),
    );

    // a verified BRV cannot be edited or cancelled (BR-BRV-06)
    expect(
      (await maker.put(base, body({ brnch: undefined }), { headers: ifm(ok.json().rowVer) })).json()
        .code,
    ).toBe('invalid_state');
    expect(
      (
        await checker.post(
          `${base}/cancel`,
          { reason: 'Entered twice by mistake' },
          { headers: ifm(ok.json().rowVer) },
        )
      ).json().ruleId,
    ).toBe('BR-BRV-06');

    // BR-BRV-05: bounce debits both ledgers (reversal rows)
    const bounce = await checker.post(
      `${base}/bounce`,
      { reason: 'Insufficient funds per bank', returnDate: '2026-11-25' },
      { headers: ifm(ok.json().rowVer) },
    );
    expect(bounce.statusCode, bounce.body).toBe(200);
    expect(bounce.json()).toMatchObject({
      brv: { status: 'BOUNCED', returnDate: '2026-11-25' },
      impact: { releasedOcs: [], confirmedOcs: [] },
    });
    expect(await dcBalance()).toBe('0.00');
    // P2-08: receipt cancellation advice continues the legacy YYYY-NNNN series
    expect(bounce.json().impact.adviceNo).toMatch(/^2027-\d{4}$/);
    expect(Number(bounce.json().impact.adviceNo.slice(5))).toBeGreaterThan(22);
    const adv = (await checker.get('/api/v1/cancellations?kind=receipt&pageSize=5')).json();
    expect(adv.items[0]).toMatchObject({
      kind: 'BOUNCE',
      adviceNo: bounce.json().impact.adviceNo,
      amount: '600000.00',
    });
  });

  it('BR-BRV-06: cancel while entered; clear after verification', async () => {
    const maker = await as({ 1: ['FINANCE'] });
    const checker = await as({ 1: ['FINANCE'] });
    const a = (await maker.post('/api/v1/brv', body())).json();
    const cx = await maker.post(
      `/api/v1/brv/1/${a.receiptNo}/cancel`,
      { reason: 'Customer paid by another cheque' },
      { headers: ifm(a.rowVer) },
    );
    expect(cx.json()).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Customer paid by another cheque',
    });

    const b = (await maker.post('/api/v1/brv', body({ amount: '1000' }))).json();
    const v = (
      await checker.post(
        `/api/v1/brv/1/${b.receiptNo}/verify`,
        { method: 'STATEMENT', bankRef: 'Stmt 23-11' },
        { headers: ifm(b.rowVer) },
      )
    ).json();
    const cl = await checker.post(
      `/api/v1/brv/1/${b.receiptNo}/clear`,
      { clearDate: '2026-11-24' },
      { headers: ifm(v.rowVer) },
    );
    expect(cl.json()).toMatchObject({ status: 'CLEARED', clearDate: '2026-11-24' });
  });

  it('references and branch scope; legacy BRVs read with their old status', async () => {
    const f = await as({ 1: ['FINANCE'] });
    const bad = await f.post('/api/v1/brv', body({ depositAccount: 'NOPE', instCode: 'X' }));
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toMatch(/company account/);
    expect((await f.post('/api/v1/brv', body({ brnch: 2 }))).statusCode).toBe(403);
    expect((await f.get('/api/v1/brv?brnch=2')).statusCode).toBe(403);
    const legacy = (await f.get('/api/v1/brv?status=CLEARED&pageSize=1')).json();
    expect(legacy.items[0]).toMatchObject({ brnch: 1, status: 'CLEARED' });
    const one = await f.get(`/api/v1/brv/1/${legacy.items[0].receiptNo}`);
    expect(one.statusCode, one.body).toBe(200);
    expect(one.json().linkedOcs).toEqual(expect.any(Array));
  });

  it('receipt print is queued for the worker', async () => {
    const f = await as({ 1: ['FINANCE'] });
    const a = (await f.post('/api/v1/brv', body())).json();
    const r = await f.post(`/api/v1/brv/1/${a.receiptNo}/receipt`, {});
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json().entityKey).toBe(`1|${a.receiptNo}`);
  });
});
