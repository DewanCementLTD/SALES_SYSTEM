import { describe, expect, it } from 'vitest';
import { invoiceQtyTon, invoiceTax } from './invoice.js';

const base = { mrpPerTon: '30272', stPct: '18', fedPerTon: '4000' };

describe('invoice tax (BR-TAX)', () => {
  it('BR-TAX-01…05: reproduces invoice 8445 to the paisa', () => {
    const t = invoiceTax({ ...base, qtyTon: '35', ratePerTon: '24300', whtPct: '0.1' });
    expect(t).toMatchObject({
      retailExcl: '757898.31',
      fed: '140000.00',
      retailValue: '897898.31',
      stPerTon: '4617.76',
      salesTax: '161621.60',
      taxInclusiveValue: '1059519.91',
      saleProceeds: '850500.00',
      valueExcl: '548878.40',
      rateExclPerTon: '15682.24',
      wht: '850.50',
      totalCollectable: '851350.50',
    });
  });

  it('BR-TAX-02: sales tax is on the retail price, not on the customer value', () => {
    const a = invoiceTax({ ...base, qtyTon: '10', ratePerTon: '24300' });
    const b = invoiceTax({ ...base, qtyTon: '10', ratePerTon: '20000' });
    expect(a.salesTax).toBe(b.salesTax);
    expect(a.valueExcl).not.toBe(b.valueExcl);
  });

  it('BR-TAX-06: a configured further tax is refused until its computation is confirmed', () => {
    expect(() =>
      invoiceTax({ ...base, qtyTon: '1', ratePerTon: '24300', furtherTaxPct: '3' }),
    ).toThrow(/Further tax/);
  });

  it('BR-INV-01: invoice quantity from the net weight or the bags', () => {
    expect(invoiceQtyTon({ basis: 'NET_WEIGHT', allocNetKg: 20046, plannedTon: '20' })).toBe(
      '20.046',
    );
    expect(invoiceQtyTon({ basis: 'BAGS', allocNetKg: 20046, plannedTon: '20' })).toBe('20.000');
  });
});
