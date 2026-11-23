// Re-pricing (BUSINESS_RULES BR-PRC-07/08, TASKS P2-07). A new rate applies to open DOs whose rate
// lock (DO_RATE_LOCK_DAYS from issue) ended before the new rate's effective date. The extra value
// is checked against each customer's available balance; DOs not covered go ON_HOLD with their
// shortfall (Sales collects a BRV or cancels the DO). The rate itself applies at dispatch (P3).
import { dec, repriceImpact } from '@dcl/shared';
import { recordAudit } from '../audit/service.js';
import * as balance from '../ledger/balance.js';
import { notifyRole } from '../approvals/service.js';
import { getDo, holdDo, keyOf } from './service.js';

const toDate = (s) => new Date(`${s}T00:00:00+05:00`);

/** Open DOs past their rate lock on `effectiveFrom`, with the impact of `newRate`. */
export async function preview(
  tx,
  brnch,
  { productCode, priceCode, customerCode, newRate, effectiveFrom },
  now,
) {
  const binds = { b: brnch, p: productCode, ef: toDate(effectiveFrom) };
  const where = [
    'd.BRNCH = :b',
    "d.DOC_STATUS IN ('ISSUED', 'PARTLY_DISPATCHED')",
    'd.PRODUCT_CODE = :p',
    'd.RATE_LOCK_UNTIL < :ef', // BR-PRC-07: still locked → keeps its OC rate
  ];
  if (priceCode) {
    where.push('d.PRICE_CODE = :pc');
    binds.pc = priceCode;
  }
  if (customerCode) {
    where.push('d.CUSTOMER_CODE = :cu');
    binds.cu = customerCode;
  }
  const rows = await tx.many(
    `SELECT d.DO_TYPE, TO_CHAR(d.DEL_ORDER_NO) AS DO_NO, d.CUSTOMER_CODE, c.CUSTOMER_NAME, d.PRICE_CODE,
            d.DO_QUANTITY - NVL(d.DISPATCHED_TON, 0) AS REMAINING, d.DO_RATE, d.RATE_LOCK_UNTIL, d.ROW_VER
       FROM DELIVERY_ORDER d
       LEFT JOIN CUSTOMER_INFO c ON c.BRNCH = d.BRNCH AND c.CUSTOMER_CODE = d.CUSTOMER_CODE
      WHERE ${where.join(' AND ')} AND d.DO_QUANTITY - NVL(d.DISPATCHED_TON, 0) > 0
      ORDER BY d.CUSTOMER_CODE, d.ORDER_DATE, d.DEL_ORDER_NO`,
    binds,
    { maxRows: 1000 },
  );
  const customers = [...new Set(rows.map((r) => r.CUSTOMER_CODE))];
  const avail = {};
  for (const c of customers) {
    avail[c] = (await balance.available(tx, { brnch, customerCode: c, now })).available;
  }
  const lines = repriceImpact(
    rows.map((r) => ({
      key: keyOf(brnch, r.DO_TYPE, r.DO_NO),
      brnch,
      doType: r.DO_TYPE,
      doNo: r.DO_NO,
      customerCode: r.CUSTOMER_CODE,
      customerName: r.CUSTOMER_NAME ?? null,
      priceCode: r.PRICE_CODE ?? null,
      remainingTon: dec(r.REMAINING).toFixed(3),
      rate: r.DO_RATE,
      rateLockUntil: r.RATE_LOCK_UNTIL,
      rowVer: Number(r.ROW_VER),
    })),
    avail,
    newRate,
  );
  return {
    lines,
    availableByCustomer: avail,
    toHold: lines.filter((l) => dec(l.shortfall).gt(0)).length,
    totalShortfall: lines.reduce((s, l) => s.plus(dec(l.shortfall)), dec(0)).toFixed(2),
  };
}

/** Put the DOs with a shortfall ON_HOLD (reason + shortfall) and notify Sales. */
export async function apply(tx, actor, brnch, body) {
  const p = await preview(tx, brnch, body, actor.now);
  const held = [];
  for (const l of p.lines.filter((x) => dec(x.shortfall).gt(0))) {
    const d = await getDo(tx, brnch, l.doType, l.doNo);
    await holdDo(tx, actor, brnch, l.doType, l.doNo, d.rowVer, {
      reason: `Re-priced ${l.oldRate} → ${l.newRate} from ${body.effectiveFrom}: collect the shortfall or cancel (BR-PRC-08)`,
      shortfall: l.shortfall,
    });
    held.push({
      doType: l.doType,
      doNo: l.doNo,
      customerCode: l.customerCode,
      shortfall: l.shortfall,
    });
  }
  if (held.length) {
    // BR-PRC-08: Sales collects the difference or cancels the DO
    await notifyRole(
      tx,
      'SALES_MANAGER',
      brnch,
      {
        title: `${held.length} DO(s) on hold after re-pricing`,
        body: `${body.productCode} at ${body.newRate} from ${body.effectiveFrom}: collect the shortfall or cancel.`,
        link: '/delivery/outstanding',
      },
      actor.now,
    );
  }
  await recordAudit(tx, actor.audit, {
    entity: 'DELIVERY_ORDER',
    key: `${brnch}|REPRICE|${body.productCode}`,
    action: 'REPRICE',
    brnch,
    newValues: { ...body, held: held.length, totalShortfall: p.totalShortfall },
  });
  return { held, checked: p.lines.length, totalShortfall: p.totalShortfall };
}
