import { describe, expect, it } from 'vitest';
import { noteDocType, noteTotals, salesReturnProblem, zNoteCreate } from './note.js';

describe('credit / debit notes (BR-NOTE)', () => {
  it('BR-NOTE-02: net = Σ lines − WHT, WHT per line rounded half up to the paisa', () => {
    const t = noteTotals([
      { particular: 'Commission Oct', amount: '100000', whtPct: '12' },
      { particular: 'Freight', amount: '333.33', whtPct: '1.5' }, // 4.99995 → 5.00
      { particular: 'Adjustment', amount: '50' },
    ]);
    expect(t.lines.map((l) => l.wht)).toEqual(['12000.00', '5.00', '0.00']);
    expect(t).toMatchObject({ gross: '100383.33', wht: '12005.00', net: '88378.33' });
  });

  it('BR-NOTE-01: credit and debit notes have their own counters', () => {
    expect(noteDocType('C')).toBe('CN');
    expect(noteDocType('D')).toBe('DN');
  });

  it('BR-NOTE-01: the form needs a 3-digit type, a line and positive amounts', () => {
    const ok = {
      kind: 'C',
      noteType: '004',
      customerCode: '912-351',
      date: '2026-11-25',
      lines: [{ particular: 'Sales return', amount: '1000' }],
    };
    expect(zNoteCreate.safeParse(ok).success).toBe(true);
    expect(zNoteCreate.safeParse({ ...ok, noteType: '4' }).success).toBe(false);
    expect(zNoteCreate.safeParse({ ...ok, lines: [] }).success).toBe(false);
    expect(
      zNoteCreate.safeParse({ ...ok, lines: [{ particular: 'Zero', amount: '0' }] }).success,
    ).toBe(false);
    expect(
      zNoteCreate.safeParse({ ...ok, lines: [{ particular: 'WHT', amount: '1', whtPct: '101' }] })
        .success,
    ).toBe(false);
  });

  it('BR-NOTE-01: a sales return stays within its invoice and customer', () => {
    const inv = { customerCode: '912-351', status: 'FBR_ACCEPTED', totalCollectable: '850000.00' };
    const note = { customerCode: '912-351', net: '500000.00', earlierReturns: '300000.00' };
    expect(salesReturnProblem(inv, note)).toBeNull();
    expect(salesReturnProblem(inv, { ...note, net: '550000.01' })?.detail).toMatch(/550000.00/);
    expect(salesReturnProblem(inv, { ...note, customerCode: '912-352' })?.detail).toMatch(
      /another customer/,
    );
    expect(salesReturnProblem({ ...inv, status: 'CANCELLED' }, note)?.detail).toMatch(/cancelled/);
  });
});
