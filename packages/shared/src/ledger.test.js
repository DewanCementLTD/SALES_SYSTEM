import { describe, expect, it } from 'vitest';
import {
  availableBalance,
  balanceSide,
  narration,
  openValue,
  reversalEntry,
  runningStatement,
  shortfall,
  unusedApprovedCredit,
  zLedgerEntry,
} from './index.js';

const entry = (o) => ({
  brnch: 1,
  customerCode: '102-04',
  ledgerType: 'DC',
  entryDate: '2026-11-23',
  docType: 'BRV',
  docNo: '2026100764',
  entryKind: 'RECEIPT',
  narration: 'x',
  ...o,
});

describe('ledger (P2-00)', () => {
  it('BR-LED: an entry has exactly one side; zero only for a memo row', () => {
    expect(zLedgerEntry.safeParse(entry({ credit: '500000' })).success).toBe(true);
    expect(zLedgerEntry.safeParse(entry({ debit: '1', credit: '1' })).success).toBe(false);
    expect(zLedgerEntry.safeParse(entry({})).success).toBe(false);
    expect(zLedgerEntry.safeParse(entry({ entryKind: 'MEMO', ledgerType: 'DO' })).success).toBe(
      true,
    );
    expect(zLedgerEntry.safeParse(entry({ debit: '-5' })).success).toBe(false);
    expect(zLedgerEntry.safeParse(entry({ docType: 'XX', credit: '1' })).success).toBe(false);
  });

  it('BR-LED-01: narration is built from the source document', () => {
    expect(narration.brv({ brvNo: '2026100764', instrument: 'IBFT', bank: 'MBL' })).toBe(
      'BRV # 2026100764 · IBFT · MBL',
    );
    expect(
      narration.invoice({ dcNo: '175002', invoiceNo: '8445', qtyTon: '35', rate: '24300' }),
    ).toBe('DC # 175002 · INV # 8445 · 35.000 t @ 24,300.00');
    expect(narration.do({ doNo: 9, qtyTon: '10.5', rate: '1000' })).toBe(
      'DO # 9 · 10.500 t @ 1,000.00',
    );
  });

  it('BR-LED: a reversal swaps the sides, keeps the document and points at the original', () => {
    const orig = { ...entry({ credit: '1000.00', debit: '0.00' }), docLine: 0, ledgerId: 77 };
    const r = reversalEntry(orig, {
      entryDate: '2026-11-24',
      docType: 'BOUNCE',
      entryKind: 'RETURN',
    });
    expect(r).toMatchObject({
      debit: '1000.00',
      credit: '0.00',
      docType: 'BOUNCE',
      docNo: '2026100764',
      entryKind: 'RETURN',
      reversalOf: 77,
    });
    expect(reversalEntry(orig, { entryDate: '2026-11-24' }).entryKind).toBe('RECEIPT_REV');
  });

  it('R1/R13: running = previous + debit − credit; advance is negative', () => {
    const s = runningStatement('1000', [
      { debit: '500.00', credit: '0.00' },
      { debit: '0.00', credit: '2000.00' },
    ]);
    expect(s.lines.map((l) => l.running)).toEqual(['1500.00', '-500.00']);
    expect(s).toMatchObject({
      opening: '1000.00',
      closing: '-500.00',
      totals: { debit: '500.00', credit: '2000.00' },
    });
    expect(balanceSide(s.closing)).toBe('ADVANCE');
    expect(balanceSide('0')).toBe('NIL');
  });
});

describe('available balance (P1-08)', () => {
  it('BR-BAL-01: − DC balance − open commitments + unused credit', () => {
    const b = availableBalance({
      dcLedgerBalance: '-1000000', // advance of 10 lakh
      commitments: [{ value: '300000' }, { value: '200000.50' }],
      credit: {
        hasCreditLimitsRow: true,
        types: [
          { current: '500000', availed: '100000' },
          { current: '0', availed: '50' }, // over-availed type never goes below 0
        ],
      },
    });
    expect(b).toEqual({
      dcLedgerBalance: '-1000000.00',
      openCommitments: '500000.50',
      unusedCredit: '400000.00',
      available: '899999.50',
    });
  });

  it('BR-BAL-06: without a CREDIT_LIMITS row the customer card limit is the one bucket', () => {
    expect(unusedApprovedCredit({ hasCreditLimitsRow: false, legacyCreditLimit: '250000' })).toBe(
      '250000.00',
    );
    expect(unusedApprovedCredit({ hasCreditLimitsRow: false, legacyCreditLimit: null })).toBe(
      '0.00',
    );
  });

  it('BR-BAL-01: open value = undispatched tons × rate, never negative', () => {
    expect(openValue({ qtyTon: '35', dispatchedTon: '10.5', rate: '24300' })).toBe('595350.00');
    expect(openValue({ qtyTon: '35', dispatchedTon: '36', rate: '24300' })).toBe('0.00');
  });

  it('BR-BAL-03: shortfall shown only when the value exceeds the available balance', () => {
    expect(shortfall('1000', '400')).toBe('600.00');
    expect(shortfall('400', '1000')).toBe('0.00');
  });
});

describe('re-pricing (P2-07)', () => {
  it('BR-PRC-08: extras use the customer balance in order; the rest is the shortfall', async () => {
    const { repriceImpact } = await import('./index.js');
    const r = repriceImpact(
      [
        { key: 'a', customerCode: 'C1', remainingTon: '10', rate: '24000' },
        { key: 'b', customerCode: 'C1', remainingTon: '10', rate: '24000' },
        { key: 'c', customerCode: 'C2', remainingTon: '5', rate: '25000' },
        { key: 'd', customerCode: 'C2', remainingTon: '5', rate: '26000' },
      ],
      { C1: '15000', C2: '-100' },
      '25500',
    );
    expect(r.map((x) => [x.key, x.extra, x.shortfall])).toEqual([
      ['a', '15000.00', '0.00'],
      ['b', '15000.00', '15000.00'],
      ['c', '2500.00', '2500.00'],
      ['d', '-2500.00', '0.00'], // a lower rate never holds a DO
    ]);
  });
});
