import { describe, expect, it } from 'vitest';
import { CREDIT_TYPES, unusedCredit, zCreditLimitRequest } from './credit.js';

describe('credit limits (BR-CUS-07)', () => {
  it('BR-CUS-07: ten credit types A–J', () => {
    expect(CREDIT_TYPES).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
  });
  it('BR-CUS-07: unused = current − availed, not below zero', () => {
    expect(unusedCredit('250000', '168947.60')).toBe('81052.40');
    expect(unusedCredit('100', '250')).toBe('0.00');
    expect(unusedCredit(null, null)).toBe('0.00');
  });
  it('BR-CUS-07: request needs a type, an amount and a remark', () => {
    expect(
      zCreditLimitRequest.safeParse({
        creditType: 'A',
        amount: '500000',
        remark: 'Approved by DGM',
      }).success,
    ).toBe(true);
    expect(
      zCreditLimitRequest.safeParse({ creditType: 'K', amount: '1', remark: 'x y z' }).success,
    ).toBe(false);
    expect(
      zCreditLimitRequest.safeParse({ creditType: 'A', amount: '-5', remark: 'x y z' }).success,
    ).toBe(false);
  });
});
