// Invoice finalisation after the weighing (TASKS P3-06; BR-INV-01/03, BR-TAX, BR-LED). Rolled back.
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
let keyNo = 0;
const idem = () => ({ headers: { 'idempotency-key': `inv-test-${Date.now()}-${(keyNo += 1)}` } });
const CUST = '912-351'; // filer (F)

async function seed({ wht = true } = {}) {
  return t.db.withTx(async (tx) => {
    const geo = await tx.one(
      `SELECT GEO_CODE FROM GEO_HIERARCHY WHERE BRNCH = 1 AND CITY_NAME IS NOT NULL AND ROWNUM = 1`,
    );
    const tr = await tx.one(
      'SELECT TRANSP_CODE FROM TRANSPORTER_DESC WHERE BRNCH = 1 AND ROWNUM = 1',
    );
    for (const [no, qty] of [
      ['22799000001', 35],
      ['22799000002', 15],
    ]) {
      await tx.exec(
        `INSERT INTO DELIVERY_ORDER (DEL_ORDER_NO, DO_TYPE, BRNCH, COMPC, YEAR, CUSTOMER_CODE, ORDER_NO,
           SR_NO, ORDER_DATE, SCHED_DATE, DO_QUANTITY, QTY_TYPE, NO_OF_BAGS, CANCEL_CODE, POST, DOC_STATUS,
           ROW_VER, DO_RATE, DO_VALUE, PRICE_CODE, PRODUCT_CODE, DISPATCHED_TON, QR_VER, CREATED_BY,
           CREATED_ON, DEST_GEO_CODE)
         VALUES (:n, 'OS', 1, 1, 2027, :c, 227000758, 1, :d, :d, :q, 'BAGS', :bags, 'N', 'N', 'ISSUED',
           1, 24300, :v, 'MRMOSDDU03', 'OPC', 0, 1, 'test', :d, :g)`,
        {
          n: no,
          c: CUST,
          q: qty,
          bags: qty * 20,
          v: qty * 24300,
          d: new Date('2026-11-23T00:00:00+05:00'),
          g: geo.GEO_CODE,
        },
      );
    }
    if (wht) await whtRate(tx);
    return tr.TRANSP_CODE;
  });
}
const whtRate = async (tx) =>
  tx.exec(
    `INSERT INTO TAX_RATE (TAX_RATE_ID, COMPC, BRNCH, TAX_KIND, FILER_STATUS, SECTION, RATE_PCT,
       EFFECTIVE_FROM, DOC_STATUS, ROW_VER, CREATED_BY, CREATED_ON)
     VALUES (SEQ_TAX_RATE.NEXTVAL, 1, 0, 'WHT', 'F', '-', 0.1, :d, 'APPROVED', 1, 'test', :d)`,
    { d: new Date('2026-07-01T00:00:00+05:00') },
  );

async function weighedTruck(transp, docs, grossKg) {
  const gate = await as({ 1: ['GATE_OPERATOR'] });
  const sup = await as({ 1: ['DISPATCH_SUPERVISOR'] });
  const gp = (
    await gate.post(
      '/api/v1/plant/gate-passes',
      {
        route: 'DO',
        packingType: 'BAG',
        vehicleNo: 'TKN-4521',
        driver: { cnic: '4210112345671', name: 'Ali Khan', mobile: '03001234567' },
        transpCode: transp,
        biltyNo: 'B-1',
        docs,
      },
      idem(),
    )
  ).json();
  const base = `/api/v1/plant/gate-passes/${gp.gpId}`;
  const manual = (kg) => ({ weightKg: kg, reason: 'Agent PC under maintenance today' });
  await sup.post(`${base}/tare`, manual(15000), idem());
  const g = await sup.post(`${base}/gross`, manual(grossKg), idem());
  expect(g.statusCode, g.body).toBe(200);
  return { gp, sup, base, gross: g.json() };
}

describe('invoice finalisation (P3-06)', () => {
  it('BR-INV-01: one invoice per DC line, consecutive numbers, tax per BR-TAX, DO, ledgers, outbox', async () => {
    const transp = await seed();
    const { gross, sup, base } = await weighedTruck(
      transp,
      [
        { doType: 'OS', doNo: '22799000001', plannedBags: 700 },
        { doType: 'OS', doNo: '22799000002', plannedBags: 300 },
      ],
      65000, // net 50,000 kg = planned
    );
    expect(gross.invoiceProblem).toBeNull();
    expect(gross.gatePass.status).toBe('INVOICED');
    const [a, b] = gross.invoices;
    expect(Number(b.invoiceNo)).toBe(Number(a.invoiceNo) + 1); // BR-NUM: gap-free, consecutive
    // 35 t of OPC at 24,300: invoice 8445 again (BR-TAX)
    expect(a).toMatchObject({
      doNo: '22799000001',
      qtyTon: '35.000',
      saleProceeds: '850500.00',
      salesTax: '161621.60',
      fed: '140000.00',
      valueExcl: '548878.40',
      wht: '850.50',
      totalCollectable: '851350.50',
    });
    expect(b).toMatchObject({ qtyTon: '15.000', saleProceeds: '364500.00' });

    const detail = (await sup.get(base)).json();
    expect(detail.invoices.map((i) => [i.doNo, i.status])).toEqual([
      ['22799000001', 'FINAL'],
      ['22799000002', 'FINAL'],
    ]);
    expect(detail.lines.every((l) => l.status === 'INVOICED' && l.invoiceId)).toBe(true);

    const dos = await t.db.read((tx) =>
      tx.many(
        `SELECT TO_CHAR(DEL_ORDER_NO) AS N, DISPATCHED_TON, DOC_STATUS FROM DELIVERY_ORDER
          WHERE BRNCH = 1 AND DEL_ORDER_NO IN (22799000001, 22799000002) ORDER BY 1`,
      ),
    );
    expect(dos.map((d) => [d.N, Number(d.DISPATCHED_TON), d.DOC_STATUS])).toEqual([
      ['22799000001', 35, 'DISPATCHED'],
      ['22799000002', 15, 'DISPATCHED'],
    ]);
    const dc = await t.db.read((tx) =>
      ledger.balance(tx, { brnch: 1, customerCode: CUST, ledgerType: 'DC' }),
    );
    // proceeds 850,500 + 364,500 and WHT 850.50 + 364.50 on top of the customer's existing DC balance
    const outbox = await t.db.read((tx) =>
      tx.many(
        `SELECT AGGREGATE_KEY FROM NOTIFICATION_OUTBOX WHERE EVENT_TYPE = 'FBR_SUBMIT' AND AGGREGATE_KEY IN (:a, :b)`,
        { a: String(a.invoiceId), b: String(b.invoiceId) },
      ),
    );
    expect(outbox).toHaveLength(2);
    const rows = await t.db.read((tx) =>
      tx.many(
        `SELECT LEDGER_TYPE, ENTRY_KIND, DEBIT FROM CUSTOMER_LEDGER WHERE DOC_TYPE = 'INV' AND DOC_NO = :n
          ORDER BY LEDGER_TYPE, ENTRY_KIND`,
        { n: a.invoiceNo },
      ),
    );
    expect(rows.map((r) => [r.LEDGER_TYPE, r.ENTRY_KIND, Number(r.DEBIT ?? 0)])).toEqual([
      ['DC', 'SALE', 850500],
      ['DC', 'WHT', 850.5],
      ['DO', 'MEMO', 0],
    ]);
    expect(dc).toBeDefined();
  });

  it('a missing WHT rate keeps the weighing and shows the problem; finalise again once it is set', async () => {
    const transp = await seed({ wht: false });
    const { gross, sup, base } = await weighedTruck(
      transp,
      [{ doType: 'OS', doNo: '22799000002', plannedBags: 300 }],
      30000,
    );
    expect(gross.gatePass).toMatchObject({ status: 'GROSS_DONE', netKg: 15000 });
    expect(gross.invoices).toEqual([]);
    expect(gross.invoiceProblem).toMatchObject({ ruleId: 'BR-TAX-05' });
    await t.db.withTx((tx) => whtRate(tx));
    const r = await sup.post(`${base}/finalise`, {}, idem());
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().gatePass.status).toBe('INVOICED');
    expect(r.json().invoices[0]).toMatchObject({ qtyTon: '15.000', wht: '364.50' });
  });
});
