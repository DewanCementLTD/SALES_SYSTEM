// Incentive schemes and runs (TASKS P4-03; BR-INC-01/03). SALES_NEW, rolled back.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, buildTestApp, createUser } from '../../../test/helpers/app.js';

/** @type {Awaited<ReturnType<typeof buildTestApp>>} */
let t;
beforeEach(async () => {
  t = await buildTestApp();
  t.clock.set('2026-11-25T05:00:00Z');
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
const ifm = (v) => ({ headers: { 'if-match': `"${v}"` } });

/** Invoices of October: 912-351 OPC 2166.11 t + SRC 10 t, 102-04 OPC 35 t, one cancelled. */
async function seedInvoices() {
  await t.db.withTx(async (tx) => {
    const gp = await tx.nextId('SEQ_GATE_PASS');
    const now = t.clock.now();
    await tx.exec(
      `INSERT INTO GATE_PASS (GP_ID, BRNCH, COMPC, STATUS, ROUTE, PACKING_TYPE, VEHICLE_NO, GATE_IN_ON,
         GATE_IN_BY, CREATED_ON, ROW_VER)
       VALUES (:gp, 1, 1, 'EXITED', 'DO', 'BAG', 'TKN-1', :now, 'test', :now, 1)`,
      { gp, now },
    );
    let no = 99990000;
    for (const [cust, prod, qty, status, day] of [
      ['912-351', 'OPC', 2000, 'FBR_ACCEPTED', '2026-10-03'],
      ['912-351', 'OPC', 166.11, 'FBR_ACCEPTED', '2026-10-31'],
      ['912-351', 'SRC', 10, 'FBR_ACCEPTED', '2026-10-15'],
      ['102-04', 'OPC', 35, 'FINAL', '2026-10-20'],
      ['102-04', 'OPC', 50, 'CANCELLED', '2026-10-21'],
      ['102-04', 'OPC', 70, 'FINAL', '2026-11-01'], // after the period
    ]) {
      no += 1;
      await tx.exec(
        `INSERT INTO SALES_INVOICE (INVOICE_ID, BRNCH, COMPC, INVOICE_YEAR, INVOICE_NO, INVOICE_DATE, STATUS,
           GP_ID, SRC_KIND, CUSTOMER_CODE, PRODUCT_CODE, QTY_BASIS, QTY_TON, RATE_INCL, RETAIL_VALUE_EXCL,
           FED_PER_TON, FED_AMT, RETAIL_VALUE, ST_PCT, ST_AMT, FURTHER_TAX_PCT, FURTHER_TAX_AMT, MARKET_VALUE,
           SALE_PROCEEDS, VALUE_EXCL, RATE_EXCL, WHT_PCT, WHT_AMT, TOTAL_COLLECTABLE, CREATED_BY, CREATED_ON,
           ROW_VER)
         VALUES (SEQ_SALES_INVOICE.NEXTVAL, 1, 1, 2027, :no, :d, :st, :gp, 'DC', :c, :p, 'NET_WEIGHT', :q,
           24300, 1, 0, 0, 1, 18, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 'test', :now, 1)`,
        { no, d: new Date(`${day}T10:00:00+05:00`), st: status, gp, c: cust, p: prod, q: qty, now },
      );
    }
  });
}

const scheme = (extra = {}) => ({
  memoNo: 'MKT/INC/10-26',
  memoDate: '2026-11-01',
  dateFrom: '2026-10-01',
  dateTo: '2026-10-31',
  customerFrom: '100-00',
  customerTo: '999-99',
  remarks: 'October dispatch incentive',
  products: [
    { productCode: 'OPC', rate: '700' },
    { productCode: 'SRC', rate: '450.50' },
  ],
  ...extra,
});

describe('incentive schemes and runs (P4-03)', () => {
  it('BR-INC-01/03: preview → commit writes details and one DRAFT credit note 008 per customer; overlap blocked', async () => {
    await seedInvoices();
    const sm = await as({ 1: ['SALES_MANAGER'] });
    const fm = await as({ 1: ['FINANCE_MANAGER'] });

    expect(
      (await sm.post('/api/v1/incentives/schemes', scheme({ dateTo: '2026-09-30' }))).statusCode,
    ).toBe(400);
    expect(
      (
        await sm.post(
          '/api/v1/incentives/schemes',
          scheme({ products: [{ productCode: 'ZZZZ', rate: '1' }] }),
        )
      ).json().ruleId,
    ).toBe('BR-INC-01');
    let r = await sm.post('/api/v1/incentives/schemes', scheme());
    expect(r.statusCode, r.body).toBe(201);
    const s = r.json();
    expect(s).toMatchObject({
      status: 'DRAFT',
      dateFrom: '2026-10-01',
      products: [
        { productCode: 'OPC', rate: '700.00' },
        { productCode: 'SRC', rate: '450.50' },
      ],
    });

    r = await sm.post('/api/v1/incentives/runs/preview', { srlNo: s.srlNo });
    expect(r.statusCode, r.body).toBe(200);
    const p = r.json();
    expect(p.customers.map((c) => [c.customerCode, c.qtyTon, c.amount])).toEqual([
      ['102-04', '35.000', '24500.00'],
      ['912-351', '2176.110', '1520782.00'], // 2166.11 × 700 + 10 × 450.50
    ]);
    expect(p).toMatchObject({ qtyTon: '2211.110', amount: '1545282.00' });

    // incentive.commit is the Finance Manager's (SALES_MANAGER has incentive.run only)
    expect(
      (await sm.post('/api/v1/incentives/runs/commit', { srlNo: s.srlNo }, ifm(s.rowVer)))
        .statusCode,
    ).toBe(403);
    r = await fm.post('/api/v1/incentives/runs/commit', { srlNo: s.srlNo }, ifm(s.rowVer));
    expect(r.statusCode, r.body).toBe(200);
    const done = r.json();
    expect(done).toMatchObject({ status: 'COMMITTED', total: '1545282.00' });
    expect(done.details.map((d) => [d.customerCode, d.productCode, d.qtyTon, d.amount])).toEqual([
      ['102-04', 'OPC', '35.000', '24500.00'],
      ['912-351', 'OPC', '2166.110', '1516277.00'],
      ['912-351', 'SRC', '10.000', '4505.00'],
    ]);
    expect(done.notes.map((n) => [n.customerCode, n.net, n.status])).toEqual([
      ['102-04', '24500.00', 'DRAFT'],
      ['912-351', '1520782.00', 'DRAFT'],
    ]);
    const note = (await fm.get(`/api/v1/notes/1/C/${done.notes[1].srlNo}`)).json();
    expect(note).toMatchObject({ noteType: '008', sourceRun: `INC ${s.srlNo}` });
    expect(note.lines.map((l) => l.particular)).toEqual([
      'Incentive OPC 2166.110 t @ 700.00',
      'Incentive SRC 10.000 t @ 450.50',
    ]);
    expect(
      (await fm.post('/api/v1/incentives/runs/commit', { srlNo: s.srlNo }, ifm(done.rowVer)))
        .statusCode,
    ).toBe(409); // committed once

    // BR-INC-03: a scheme overlapping October for OPC
    r = await sm.post(
      '/api/v1/incentives/schemes',
      scheme({
        dateFrom: '2026-10-31',
        dateTo: '2026-11-30',
        products: [{ productCode: 'OPC', rate: '100' }],
      }),
    );
    const s2 = r.json();
    const p2 = (await sm.post('/api/v1/incentives/runs/preview', { srlNo: s2.srlNo })).json();
    expect(p2.customers.flatMap((c) => c.lines.map((l) => [c.customerCode, l.paidBy]))).toEqual([
      ['102-04', s.srlNo],
      ['912-351', s.srlNo],
    ]);
    r = await fm.post('/api/v1/incentives/runs/commit', { srlNo: s2.srlNo }, ifm(s2.rowVer));
    expect(r.json()).toMatchObject({ ruleId: 'BR-INC-03' });
    r = await sm.post(
      `/api/v1/incentives/schemes/1/${s2.srlNo}/cancel`,
      { reason: 'Overlaps the October scheme' },
      ifm(s2.rowVer),
    );
    expect(r.json()).toMatchObject({ status: 'CANCELLED' });

    const list = (await sm.get('/api/v1/incentives/schemes?status=COMMITTED')).json();
    expect(list.items.map((x) => x.srlNo)).toContain(s.srlNo);
    const isb = await as({ 2: ['FINANCE_MANAGER'] }, 2);
    expect((await isb.get(`/api/v1/incentives/schemes/1/${s.srlNo}`)).statusCode).toBe(403);
  });

  it('BR-INC-01: nothing invoiced in the period → nothing to commit', async () => {
    const sm = await as({ 1: ['SALES_MANAGER'] });
    const fm = await as({ 1: ['FINANCE_MANAGER'] });
    const s = (
      await sm.post(
        '/api/v1/incentives/schemes',
        scheme({ dateFrom: '2020-01-01', dateTo: '2020-01-31' }),
      )
    ).json();
    const r = await fm.post('/api/v1/incentives/runs/commit', { srlNo: s.srlNo }, ifm(s.rowVer));
    expect(r.json()).toMatchObject({ ruleId: 'BR-INC-01' });
  });
});
