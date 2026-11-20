import { describe, expect, it } from 'vitest';
import { formatDocNo, parseDocNo } from './numbering-format.js';

describe('document number display (BR-NUM-03)', () => {
  it('BR-NUM-03: adds .1/.2 suffix for permit, DO, DC, DM, invoice', () => {
    expect(formatDocNo(2027746, 1, 'PMT')).toBe('2027746.1');
    expect(formatDocNo('8445', 2, 'INV')).toBe('8445.2');
    expect(formatDocNo(123, 1, 'SRF')).toBe('123');
  });

  it('parses numbers with or without suffix', () => {
    expect(parseDocNo('2027746.1')).toEqual({ no: '2027746', brnch: 1 });
    expect(parseDocNo('8445')).toEqual({ no: '8445', brnch: null });
    expect(parseDocNo('84a5')).toBeNull();
  });
});
