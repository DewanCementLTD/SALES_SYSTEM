// Invoice tax calculator (BUSINESS_RULES §7 BR-TAX-01…09, REQUIREMENTS_SPEC 9.3). Pure function,
// authoritative in the API, preview in the UI. Prices are tax-inclusive; the invoice works backwards.
//
// Part A — taxes on the retail price (MRP, inclusive of FED and sales tax):
//   retail value       = qty × MRP × 100 ÷ (100 + ST%)          (rounded to the paisa)
//   FED                = FED per ton × qty                       (BR-TAX-03)
//   tax-excl. retail   = retail value − FED
//   sales tax per ton  = MRP × ST% ÷ (100 + ST%), to the paisa   (legacy keeps it per ton:
//                        PRODUCT_DESC_T 4,617.76 for MRP 30,272)
//   sales tax          = sales tax per ton × qty                 (BR-TAX-02)
// Part B — the customer's invoice:
//   sale proceeds      = customer inclusive rate × qty           (BR-TAX-04)
//   value exclusive    = sale proceeds − FED − sales tax; rate excl. = value excl. ÷ qty
//   WHT                = WHT% × sale proceeds; total collectable = proceeds + WHT (BR-TAX-05)
// Reproduces invoice 8445 to the paisa (test). Figures are stored, never recalculated (BR-TAX-08).
import { dec, roundMoney } from './money.js';

const m2 = (v) => roundMoney(v).toFixed(2);

/**
 * @param {{ qtyTon: string|number, mrpPerTon: string, stPct: string, fedPerTon: string,
 *   ratePerTon: string, whtPct?: string, furtherTaxPct?: string }} p
 */
export function invoiceTax(p) {
  const qty = dec(p.qtyTon);
  if (qty.lte(0)) throw new Error('Invoice quantity must be more than 0');
  const st = dec(p.stPct);
  const mrp = dec(p.mrpPerTon);
  const div = dec(100).plus(st);
  const retailValue = roundMoney(qty.times(mrp).times(100).dividedBy(div));
  const fed = roundMoney(dec(p.fedPerTon ?? 0).times(qty));
  const stPerTon = roundMoney(mrp.times(st).dividedBy(div));
  const salesTax = roundMoney(stPerTon.times(qty));
  const proceeds = roundMoney(dec(p.ratePerTon).times(qty));
  const valueExcl = proceeds.minus(fed).minus(salesTax);
  // BR-TAX-06: further tax for unregistered buyers is not applied until its base is confirmed
  if (p.furtherTaxPct && dec(p.furtherTaxPct).gt(0))
    throw new Error(
      'Further tax (BR-TAX-06) is configured but its computation is not confirmed yet',
    );
  const wht = roundMoney(
    dec(p.whtPct ?? 0)
      .times(proceeds)
      .dividedBy(100),
  );
  return {
    qtyTon: qty.toFixed(3),
    // Part A
    mrpPerTon: m2(mrp),
    retailValue: m2(retailValue),
    retailExcl: m2(retailValue.minus(fed)),
    fed: m2(fed),
    stPct: st.toFixed(2),
    stPerTon: m2(stPerTon),
    salesTax: m2(salesTax),
    taxInclusiveValue: m2(retailValue.plus(salesTax)),
    // Part B
    ratePerTon: m2(dec(p.ratePerTon)),
    saleProceeds: m2(proceeds),
    valueExcl: m2(valueExcl),
    rateExclPerTon: m2(valueExcl.dividedBy(qty)),
    whtPct: dec(p.whtPct ?? 0).toFixed(3),
    wht: m2(wht),
    totalCollectable: m2(proceeds.plus(wht)),
  };
}

/** BR-INV-01 / Q2: invoice quantity from the allocated net weight (NET_WEIGHT) or planned bags. */
export function invoiceQtyTon({ basis, allocNetKg, plannedTon }) {
  if (basis === 'BAGS') return dec(plannedTon).toFixed(3);
  return dec(allocNetKg).dividedBy(1000).toFixed(3);
}
