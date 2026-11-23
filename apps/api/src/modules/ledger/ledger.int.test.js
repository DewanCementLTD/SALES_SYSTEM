// Ledger posting + statement (TASKS P2-00, BR-LED) and balance (TASKS P1-08, BR-BAL).
// SALES_NEW, rolled back.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, buildTestApp, createUser } from '../../../test/helpers/app.js';
import * as balance from './balance.js';
import * as ledger from './service.js';

/** @type {Awaited<ReturnType<typeof buildTestApp>>} */
let t;
beforeEach(async () => {
  t = await buildTestApp();
});
afterEach(async () => {
  await t.close();
});

const CUST = '102-04'; // Karachi legacy customer (no CREDIT_LIMITS row)
const actor = () => ({ usrid: 'test', now: t.clock.now() });
const row = (o) => ({
  brnch: 1,
  customerCode: CUST,
  ledgerType: 'DC',
  entryDate: '2026-11-20',
  docType: 'BRV',
  docYear: 2027,
  docNo: '900001',
  entryKind: 'RECEIPT',
  narration: 'BRV # 900001 · IBFT · MBL',
  ...o,
});

async function as(roles, brnch = 1) {
  const u = await createUser(t.db, { roles });
  const c = new Client(t.app);
  await c.login(u.usrid, u.password, { brnch });
  return c;
}

describe('ledger (P2-00)', () => {
  it('BR-LED: posts in the caller tx; the UK refuses a second posting of the same entry', async () => {
    await t.db.withTx((tx) =>
      ledger.post(tx, actor(), [
        row({ credit: '500000' }),
        row({ ledgerType: 'DO', credit: '500000' }),
      ]),
    );
    await expect(
      t.db.withTx((tx) => ledger.post(tx, actor(), [row({ credit: '500000' })])),
    ).rejects.toMatchObject({ code: 'duplicate', ruleId: 'BR-LED' });
    await expect(
      t.db.withTx((tx) => ledger.post(tx, actor(), [row({ customerCode: 'NOPE-1', credit: '1' })])),
    ).rejects.toMatchObject({ code: 'not_found' });
    const bal = await t.db.read((tx) =>
      ledger.balance(tx, { brnch: 1, customerCode: CUST, ledgerType: 'DC' }),
    );
    expect(bal).toBe('-500000.00');
  });

  it('BR-LED: a reversal is a new row; a document cannot be reversed twice', async () => {
    await t.db.withTx((tx) =>
      ledger.post(tx, actor(), [
        row({ docType: 'INV', docNo: '8445', entryKind: 'SALE', debit: '850500' }),
        row({ docType: 'INV', docNo: '8445', entryKind: 'WHT', debit: '850.50' }),
      ]),
    );
    const doc = { brnch: 1, docType: 'INV', docNo: '8445', docYear: 2027 };
    const ids = await t.db.withTx((tx) =>
      ledger.reverseDocument(tx, actor(), doc, { entryDate: '2026-11-21' }),
    );
    expect(ids).toHaveLength(2);
    const rows = await t.db.read((tx) => ledger.documentRows(tx, doc));
    expect(rows.map((r) => [r.entryKind, r.debit, r.credit, !!r.reversalOf])).toEqual([
      ['SALE', '850500.00', '0.00', false],
      ['WHT', '850.50', '0.00', false],
      ['SALE_REV', '0.00', '850500.00', true],
      ['WHT_REV', '0.00', '850.50', true],
    ]);
    await expect(
      t.db.withTx((tx) => ledger.reverseDocument(tx, actor(), doc, { entryDate: '2026-11-21' })),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('R13 statement: opening before the range, running balance, totals, closing', async () => {
    await t.db.withTx((tx) =>
      ledger.post(tx, actor(), [
        row({ entryDate: '2026-11-01', docNo: '900010', credit: '100000' }),
        row({
          entryDate: '2026-11-10',
          docType: 'INV',
          docNo: '9001',
          entryKind: 'SALE',
          debit: '60000',
        }),
        row({ entryDate: '2026-11-12', docNo: '900011', credit: '20000' }),
      ]),
    );
    const fin = await as({ 1: ['FINANCE'] });
    const res = await fin.get(`/api/v1/ledger/1/${CUST}?type=DC&from=2026-11-05&to=2026-11-30`);
    expect(res.statusCode, res.body).toBe(200);
    const s = res.json();
    expect(s).toMatchObject({
      opening: '-100000.00',
      totals: { debit: '60000.00', credit: '20000.00' },
      closing: '-60000.00',
    });
    expect(s.lines.map((l) => l.running)).toEqual(['-40000.00', '-60000.00']);
    expect(s.customerName).toBeTruthy();

    // branch scope: no access to Hattar
    expect(
      (await fin.get(`/api/v1/ledger/2/${CUST}?from=2026-11-01&to=2026-11-30`)).statusCode,
    ).toBe(403);
  });

  it('BR-BAL-01/06: available = − DC balance − open commitments + card credit limit', async () => {
    await t.db.withTx((tx) => ledger.post(tx, actor(), [row({ credit: '750000' })]));
    const before = await t.db.read((tx) =>
      balance.available(tx, { brnch: 1, customerCode: CUST, now: t.clock.now() }),
    );
    expect(before.credit.hasCreditLimitsRow).toBe(false);
    const card = before.credit.legacyCreditLimit ?? '0.00';
    const expected = (750000 + Number(card) - Number(before.openCommitments)).toFixed(2);
    expect(before.available).toBe(expected);
    expect(before.todayCollection).toEqual({ total: '750000.00', receipts: 1 });

    const fin = await as({ 1: ['FINANCE'] });
    const res = await fin.get(`/api/v1/customers/1/${CUST}/balance?value=99999999`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ available: expected, value: '99999999' });
    expect(Number(res.json().shortfall)).toBeGreaterThan(0);
  });

  it('BR-BAL-02: lockCustomer takes the row lock (and 404s for unknown customers)', async () => {
    await t.db.withTx(async (tx) => {
      await balance.lockCustomer(tx, 1, CUST);
    });
    await expect(t.db.withTx((tx) => balance.lockCustomer(tx, 1, 'NOPE-1'))).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
