// Available balance (BUSINESS_RULES §6, TASKS P1-08). The ONLY balance used for OC confirm,
// permit issue and DO re-pricing (BR-BAL-01):
//   available = − DC ledger balance − open commitments + unused approved credit
import { dec, roundMoney } from './money.js';
import { unusedCredit } from './credit.js';

/** Undispatched value of one open DO / permit area line: (qty − dispatched) × rate, ≥ 0. */
export function openValue({ qtyTon, dispatchedTon, rate }) {
  const left = dec(qtyTon).minus(dec(dispatchedTon ?? 0));
  if (left.lte(0)) return '0.00';
  return roundMoney(left.times(dec(rate ?? 0))).toFixed(2);
}

/**
 * Unused approved credit (BR-BAL-06): with a CREDIT_LIMITS row = Σ (current − availed) per type;
 * without one = CUSTOMER_INFO.CREDIT_LIMITE as one bucket (its use is the open commitments,
 * which the formula already subtracts).
 * @param {{ hasCreditLimitsRow: boolean, types?: { current: any, availed: any }[], legacyCreditLimit?: any }} credit
 */
export function unusedApprovedCredit(credit) {
  if (!credit?.hasCreditLimitsRow) return dec(credit?.legacyCreditLimit ?? 0).toFixed(2);
  return (credit.types ?? [])
    .reduce((s, t) => s.plus(dec(unusedCredit(t.current, t.availed))), dec(0))
    .toFixed(2);
}

/**
 * BR-BAL-01.
 * @param {{ dcLedgerBalance: any, commitments: { value: any }[], credit: Parameters<typeof unusedApprovedCredit>[0] }} p
 */
export function availableBalance({ dcLedgerBalance, commitments, credit }) {
  const open = commitments.reduce((s, c) => s.plus(dec(c.value)), dec(0));
  const unused = dec(unusedApprovedCredit(credit));
  const available = dec(dcLedgerBalance).negated().minus(open).plus(unused);
  return {
    dcLedgerBalance: dec(dcLedgerBalance).toFixed(2),
    openCommitments: open.toFixed(2),
    unusedCredit: unused.toFixed(2),
    available: available.toFixed(2),
  };
}

/** BR-BAL-03: shortfall = value − available, when positive; else '0.00'. */
export function shortfall(value, available) {
  const s = dec(value).minus(dec(available));
  return s.gt(0) ? s.toFixed(2) : '0.00';
}

/**
 * BR-PRC-07/08 re-pricing impact. For each open DO past its rate lock: extra = remaining tons ×
 * (new rate − old rate). Per customer the extras use up the available balance in DO order; the
 * part not covered is the DO's shortfall (→ ON_HOLD).
 * @param {{ key: string, customerCode: string, remainingTon: any, rate: any }[]} dos in order
 * @param {Record<string, any>} availableByCustomer
 * @param {any} newRate
 */
export function repriceImpact(dos, availableByCustomer, newRate) {
  const left = Object.fromEntries(Object.entries(availableByCustomer).map(([c, v]) => [c, dec(v)]));
  return dos.map((d) => {
    const extra = roundMoney(dec(d.remainingTon).times(dec(newRate).minus(dec(d.rate ?? 0))));
    const avail = left[d.customerCode] ?? dec(0);
    let short = dec(0);
    if (extra.gt(0)) {
      const covered = avail.gt(0) ? (avail.gte(extra) ? extra : avail) : dec(0);
      short = extra.minus(covered);
      left[d.customerCode] = avail.minus(extra);
    }
    return {
      ...d,
      oldRate: dec(d.rate ?? 0).toFixed(2),
      newRate: dec(newRate).toFixed(2),
      extra: extra.toFixed(2),
      shortfall: short.toFixed(2),
    };
  });
}
