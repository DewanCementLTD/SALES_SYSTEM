// Credit / debit notes (TASKS P4-01; BR-NOTE-01…05, §13 ledger). SALES_NEW, rolled back.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, buildTestApp, createUser } from '../../../test/helpers/app.js';
import * as ledger from '../ledger/service.js';

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
const CUST = '912-351';
const note = (extra = {}) => ({
  kind: 'C',
  noteType: '001',
  customerCode: CUST,
  date: '2026-11-25',
  remarks: 'Rate difference Oct-26',
  lines: [
    { particular: 'Rate difference DO 22700012', amount: '100000', whtPct: '12' },
    { particular: 'Freight', amount: '5000' },
  ],
  ...extra,
});
const rows = (srlNo, docType = 'CN') =>
  t.db.read((tx) => ledger.documentRows(tx, { brnch: 1, docType, docNo: srlNo, docYear: null }));

describe('credit / debit notes (P4-01)', () => {
  it('BR-NOTE-02/03: draft → NOTE_POST approval (maker ≠ approver) → posted Cr net in both ledgers', async () => {
    const fin = await as({ 1: ['FINANCE'] });
    const fm = await as({ 1: ['FINANCE_MANAGER'] });
    const before = await t.db.read((tx) =>
      tx.one(
        `SELECT LAST_NO FROM DOC_SEQUENCE WHERE BRNCH = 1 AND YEAR = 2027 AND DOC_TYPE = 'CN'`,
      ),
    );

    let r = await fin.post('/api/v1/notes', note());
    expect(r.statusCode, r.body).toBe(201);
    const n = r.json();
    expect(n).toMatchObject({
      kind: 'C',
      srlNo: String(Number(before.LAST_NO) + 1),
      status: 'DRAFT',
      gross: '105000.00',
      wht: '12000.00',
      net: '93000.00',
      typeName: 'ADJUSTMENTS',
    });
    expect(n.lines.map((l) => [l.srNo, l.amount, l.whtPct])).toEqual([
      [1, '100000.00', '12'],
      [2, '5000.00', null],
    ]);
    const path = `/api/v1/notes/1/C/${n.srlNo}`;

    expect((await fin.post(`${path}/submit`, {})).statusCode).toBe(400); // If-Match required
    r = await fin.post(`${path}/submit`, {}, ifm(n.rowVer));
    expect(r.statusCode, r.body).toBe(200);
    const { requestId } = r.json();
    expect(r.json().note).toMatchObject({ status: 'PENDING_APPROVAL', requestId });
    expect(await rows(n.srlNo)).toHaveLength(0);

    // FINANCE also holds note.approve, but not for its own note (BR-NOTE-03)
    expect((await fin.post(`/api/v1/approvals/${requestId}/approve`, {})).statusCode).toBe(403);
    r = await fm.post(`/api/v1/approvals/${requestId}/approve`, {});
    expect(r.statusCode, r.body).toBe(200);

    const posted = (await fin.get(path)).json();
    expect(posted).toMatchObject({ status: 'POSTED', postedBy: expect.any(String) });
    const led = await rows(n.srlNo);
    expect(led.map((x) => [x.ledgerType, x.debit, x.credit, x.entryKind])).toEqual([
      ['DO', '0.00', '93000.00', 'NOTE'],
      ['DC', '0.00', '93000.00', 'NOTE'],
    ]);
    expect(led[0].narration).toMatch(/^Credit note # \d+ · 001 ADJUSTMENTS · Rate difference/);
    const legacy = await t.db.read((tx) =>
      tx.one(
        `SELECT POST, AMOUNT, WITHHOLDING_TAX, NET_AMOUNT FROM CREDIT_NOTE WHERE BRNCH = 1 AND DB_CR_CD = 'C' AND SRL_NO = :n`,
        { n: Number(n.srlNo) },
      ),
    );
    expect(legacy).toMatchObject({ POST: 'Y' });

    // a posted note cannot be cancelled, only reversed (BR-NOTE-05)
    r = await fin.post(
      `${path}/cancel`,
      { reason: 'Entered twice by mistake' },
      ifm(posted.rowVer),
    );
    expect(r.statusCode).toBe(409);
    r = await fin.post(
      `${path}/reverse`,
      { reason: 'Rate was already corrected on DO' },
      ifm(posted.rowVer),
    );
    expect(r.statusCode, r.body).toBe(200);
    const { note: orig, reversal } = r.json();
    expect(orig).toMatchObject({ status: 'REVERSED', reversedBy: reversal.srlNo });
    expect(reversal).toMatchObject({
      kind: 'D',
      status: 'POSTED',
      reversalOf: n.srlNo,
      net: '93000.00',
      noteType: '001',
    });
    const rev = await rows(reversal.srlNo, 'DN');
    expect(rev.map((x) => [x.ledgerType, x.debit, x.credit, x.reversalOf])).toEqual([
      ['DO', '93000.00', '0.00', led[0].ledgerId],
      ['DC', '93000.00', '0.00', led[1].ledgerId],
    ]);
    // a reversal is not reversed again
    r = await fin.post(
      `/api/v1/notes/1/D/${reversal.srlNo}/reverse`,
      { reason: 'Trying to undo the reversal' },
      ifm(reversal.rowVer),
    );
    expect(r.statusCode).toBe(409);
  });

  it('BR-NOTE-03: without an active rule submit posts at once, only with note.post; cancel a draft', async () => {
    await t.db.withTx((tx) =>
      tx.exec(`UPDATE APPROVAL_RULE SET ACTIVE = 'N' WHERE DOC_TYPE = 'NOTE_POST'`),
    );
    const sm = await as({ 1: ['SALES_MANAGER'] }); // note.create, no note.post
    const fin = await as({ 1: ['FINANCE'] });
    let r = await sm.post('/api/v1/notes', note({ kind: 'D', noteType: '002' }));
    expect(r.statusCode, r.body).toBe(201);
    const d = r.json();
    r = await sm.post(`/api/v1/notes/1/D/${d.srlNo}/submit`, {}, ifm(d.rowVer));
    expect(r.statusCode).toBe(403);
    r = await fin.post(`/api/v1/notes/1/D/${d.srlNo}/submit`, {}, ifm(d.rowVer));
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ requestId: null, note: { status: 'POSTED' } });
    expect((await rows(d.srlNo, 'DN')).map((x) => x.debit)).toEqual(['93000.00', '93000.00']);

    r = await sm.post('/api/v1/notes', note());
    const c = r.json();
    r = await sm.post(
      `/api/v1/notes/1/C/${c.srlNo}/cancel`,
      { reason: 'Customer code was wrong' },
      ifm(c.rowVer),
    );
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Customer code was wrong',
    });
  });

  it('BR-NOTE-01 / OPEN-Q5: a sales return names an invoice of the customer and stays within it', async () => {
    const fin = await as({ 1: ['FINANCE'] });
    const types = (await fin.get('/api/v1/notes/types')).json().items;
    const sr = types.find((x) => x.salesReturn);
    expect(sr).toMatchObject({ code: '006', name: 'SALES RETURN' }); // Karachi codes (migration 019)

    const invoiceId = await t.db.withTx(async (tx) => {
      const gp = await tx.nextId('SEQ_GATE_PASS');
      const now = t.clock.now();
      await tx.exec(
        `INSERT INTO GATE_PASS (GP_ID, BRNCH, COMPC, STATUS, ROUTE, CUSTOMER_CODE, PACKING_TYPE, VEHICLE_NO,
           GATE_IN_ON, GATE_IN_BY, CREATED_ON, ROW_VER)
         VALUES (:gp, 1, 1, 'EXITED', 'DO', :c, 'BAG', 'TKN-1', :now, 'test', :now, 1)`,
        { gp, c: CUST, now },
      );
      const id = await tx.nextId('SEQ_SALES_INVOICE');
      await tx.exec(
        `INSERT INTO SALES_INVOICE (INVOICE_ID, BRNCH, COMPC, INVOICE_YEAR, INVOICE_NO, INVOICE_DATE, STATUS,
           GP_ID, SRC_KIND, CUSTOMER_CODE, PRODUCT_CODE, QTY_BASIS, QTY_TON, RATE_INCL, RETAIL_VALUE_EXCL,
           FED_PER_TON, FED_AMT, RETAIL_VALUE, ST_PCT, ST_AMT, FURTHER_TAX_PCT, FURTHER_TAX_AMT, MARKET_VALUE,
           SALE_PROCEEDS, VALUE_EXCL, RATE_EXCL, WHT_PCT, WHT_AMT, TOTAL_COLLECTABLE, CREATED_BY, CREATED_ON,
           ROW_VER)
         VALUES (:id, 1, 1, 2027, 99990001, :now, 'FBR_ACCEPTED', :gp, 'DC', :c, 'OPC', 'NET_WEIGHT', 10,
           24300, 205932.20, 0, 0, 205932.20, 18, 37067.80, 0, 0, 243000, 243000, 205932.20, 20593.22,
           0.1, 243, 243243, 'test', :now, 1)`,
        { id, gp, c: CUST, now },
      );
      return id;
    });
    const ret = (extra) =>
      note({
        noteType: sr.code,
        lines: [{ particular: 'Sales return 2 t', amount: '48648.60' }],
        ...extra,
      });

    let r = await fin.post('/api/v1/notes', ret({}));
    expect(r.json()).toMatchObject({ ruleId: 'BR-NOTE-01' }); // no invoice
    r = await fin.post('/api/v1/notes', note({ invoiceId })); // type 001 with an invoice
    expect(r.json()).toMatchObject({ ruleId: 'BR-NOTE-01' });
    r = await fin.post('/api/v1/notes', ret({ invoiceId, customerCode: '912-352' }));
    expect(r.statusCode).toBeGreaterThanOrEqual(404); // other customer (or not found)
    r = await fin.post('/api/v1/notes', ret({ invoiceId }));
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ invoiceId, invoiceNo: '99990001', net: '48648.60' });
    // 48,648.60 returned; 194,594.40 left of 243,243.00
    r = await fin.post(
      '/api/v1/notes',
      ret({ invoiceId, lines: [{ particular: 'Sales return rest', amount: '194594.41' }] }),
    );
    expect(r.json()).toMatchObject({ ruleId: 'BR-NOTE-01' });
    expect(r.json().detail).toMatch(/194594.40/);
    r = await fin.post(
      '/api/v1/notes',
      ret({ invoiceId, lines: [{ particular: 'Sales return rest', amount: '194594.40' }] }),
    );
    expect(r.statusCode, r.body).toBe(201);
  });

  it('branch scope: Hattar does not see or touch Karachi notes; future dates refused', async () => {
    const fin = await as({ 1: ['FINANCE'] });
    const isb = await as({ 2: ['FINANCE'] }, 2);
    let r = await fin.post('/api/v1/notes', note({ date: '2026-11-26' }));
    expect(r.json()).toMatchObject({ ruleId: 'BR-DQ-01' });
    r = await fin.post('/api/v1/notes', note());
    const n = r.json();
    const list = (await isb.get('/api/v1/notes?pageSize=100')).json();
    expect(list.items.every((x) => x.brnch === 2)).toBe(true);
    expect((await isb.get(`/api/v1/notes/1/C/${n.srlNo}`)).statusCode).toBe(403);
    r = await isb.post(`/api/v1/notes/1/C/${n.srlNo}/submit`, {}, ifm(n.rowVer));
    expect(r.statusCode).toBe(403);
    const mine = (await fin.get(`/api/v1/notes?kind=C&status=DRAFT&customer=${CUST}`)).json();
    expect(mine.items.map((x) => x.srlNo)).toContain(n.srlNo);
  });
});
