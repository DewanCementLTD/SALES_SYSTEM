import { verifyQr } from '@dcl/shared';
import { describe, expect, it } from 'vitest';
import { escapeHtml, html, raw, renderTemplate } from './index.js';

const runAt = new Date('2026-11-20T06:30:00Z');
const qrSecret = 'test-qr-secret-0001';
const data = {
  brnch: 1,
  docNo: '22746000013',
  customer: 'Al-Haram <Building> Materials',
  lines: [{ item: 'OPC 53 grade', qty: '40.000', amount: '972,000.00' }],
};

describe('print templates (P0-15)', () => {
  it('escapes interpolated text, keeps raw markup', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
    const out = html`<p>${'<b>'}</p>${raw('<i>ok</i>')}`;
    expect(out.toString()).toBe('<p>&lt;b&gt;</p><i>ok</i>');
  });

  it('renders letterhead, run time in Karachi, escaped customer, barcode and signed QR', async () => {
    const out = await renderTemplate('sample', data, { runAt, qrSecret });
    expect(out.html).toContain('Dewan Cement Limited');
    expect(out.html).toContain('No. 22746000013');
    expect(out.html).toContain('Printed 20-11-2026 11:30');
    expect(out.html).toContain('Al-Haram &lt;Building&gt; Materials');
    expect((out.html.match(/<svg/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(out.footer).toContain('System generated');
    await expect(verifyQr(out.qrPayload, qrSecret)).resolves.toMatchObject({ ok: true });
  });

  it('BR-DO-03: cancelled documents carry a CANCELLED watermark', async () => {
    const out = await renderTemplate('sample', { ...data, cancelled: true }, { runAt, qrSecret });
    expect(out.html).toContain('class="watermark"><span>CANCELLED');
  });

  it('unknown template is an error', async () => {
    await expect(renderTemplate('nope', {}, { runAt, qrSecret })).rejects.toThrow(
      /Unknown print template/,
    );
  });
});

describe('Contract Review Form (BR-SRF-07)', () => {
  const srf = {
    srfNo: '66461227',
    srfDate: '2026-10-22',
    contractValidTo: '2027-01-22',
    customerCode: '1210-21-001',
    customerName: 'AITMAAD BUILDERS & DEVELOPERS',
    productCode: 'OPS',
    qtyTon: '40.00',
    bags: 800,
    modeOfDelivery: 'BAGS',
    status: 'SUBMITTED',
  };
  it('shows parties, validity, order and only the clause texts that are set up', async () => {
    const out = await renderTemplate(
      'contract-review',
      {
        brnch: 2,
        srf,
        customer: { mobile: '03001234567' },
        clauses: { CRF_VALIDITY: ['Valid until {validTo}.'] },
        preparedBy: 'MKT01',
      },
      { runAt, qrSecret },
    );
    expect(out.html).toContain('Dewan Cement Limited and 1210-21-001');
    expect(out.html).toContain('AITMAAD BUILDERS &amp; DEVELOPERS');
    expect(out.html).toContain('22-10-2026 to 22-01-2027');
    expect(out.html).toContain('Valid until 22-01-2027.');
    expect(out.html).toContain('Clause text not set up');
    expect(out.html).toContain('DCL/MKT/FM/003');
    expect(out.html).not.toContain('class="watermark"');
  });
});

describe('Delivery Order print (BR-DO-03, BR-QR-01)', () => {
  const doc = {
    doType: 'OS',
    doNo: '22702003944',
    ocNo: '227000758',
    issueDate: '2026-11-23',
    customerCode: '912-351',
    customerName: 'MASHALLAH RICE MILL',
    productCode: 'OPC',
    qtyTon: '35.000',
    bags: 700,
    qrVer: 1,
    status: 'ISSUED',
  };
  it('carries a signed QR for the DO and the barcode; terms only when set up', async () => {
    const out = await renderTemplate(
      'delivery-order',
      { brnch: 1, do: doc, terms: [] },
      { runAt, qrSecret },
    );
    expect(out.html).toContain('No. 22702003944.1');
    expect(out.html).toContain('Terms text not set up');
    await expect(verifyQr(out.qrPayload, qrSecret)).resolves.toMatchObject({
      ok: true,
      doc: { docType: 'DO', brnch: 1, docNo: 'OS-22702003944', ver: 1 },
    });
    expect(out.html).not.toContain('class="watermark"');
  });
  it('BR-DO-03: a cancelled DO prints with the CANCELLED watermark', async () => {
    const out = await renderTemplate(
      'delivery-order',
      { brnch: 1, do: { ...doc, status: 'CANCELLED' }, terms: ['Lift within 48 hours.'] },
      { runAt, qrSecret },
    );
    expect(out.html).toContain('class="watermark"><span>CANCELLED');
    expect(out.html).toContain('Lift within 48 hours.');
  });
});

describe('Permit print (BR-PMT-04)', () => {
  it('area grid, no expiry unless set, signed QR', async () => {
    const out = await renderTemplate(
      'permit',
      {
        brnch: 2,
        permit: {
          permitNo: '20272301.2',
          permitDate: '2026-11-23',
          validFrom: '2026-11-23',
          validTo: null,
          customerCode: '1502-22-080',
          productCode: 'OPS',
          qtyTon: '40.000',
          status: 'ISSUED',
          areas: [
            {
              areaDoc: '2190',
              areaName: 'Rawalpindi',
              qtyTon: '40.000',
              rate: '25070.00',
              amount: '1002800.00',
              status: 'OPEN',
            },
          ],
        },
        terms: [],
      },
      { runAt, qrSecret },
    );
    expect(out.html).toContain('Rawalpindi (2190)');
    expect(out.html).not.toContain('valid to');
    expect(out.html).toContain('Terms text not set up');
    await expect(verifyQr(out.qrPayload, qrSecret)).resolves.toMatchObject({
      ok: true,
      doc: { docType: 'PMT', docNo: '20272301.2' },
    });
  });
});

describe('OC print (BR-OC-03)', () => {
  const oc = {
    ocNo: '227000758',
    orderDate: '2026-11-23',
    status: 'REVIEWED',
    customerCode: '912-351',
    customerName: 'MASHALLAH RICE MILL',
    productCode: 'OPC',
    qtyTon: '35.00',
    priceOverride: 'Y',
    schedule: [{ srNo: 1, date: '2026-11-25', qtyTon: '35.00' }],
    brvs: [],
    dos: [],
  };
  const breakdown = {
    retailPrice: '27000.00',
    tradeDisc: '0.00',
    tradeDiscPrice: '27000.00',
    salesTax: '0.00',
    fed: '0.00',
    consPrice: '27000.00',
    expense: '0.00',
    discount: '500.00',
    netPrice: '26500.00',
    value: '927500.00',
  };
  it('BR-OC-02: price breakdown marks overridden prices; DRAFT watermark before approval', async () => {
    const out = await renderTemplate(
      'order-confirmation',
      { brnch: 1, oc, breakdown, overridden: ['discount'], terms: [] },
      { runAt, qrSecret },
    );
    expect(out.html).toContain('No. 227000758.1');
    expect(out.html).toContain('Less discount *');
    expect(out.html).toContain('override pending');
    expect(out.html).toContain('927,500.00');
    expect(out.html).toContain('class="watermark"><span>DRAFT');
  });
  it('a confirmed OC prints without a watermark; cancelled with CANCELLED', async () => {
    const ok = await renderTemplate(
      'order-confirmation',
      { brnch: 1, oc: { ...oc, status: 'CONFIRMED' }, breakdown, overridden: [], terms: ['T1'] },
      { runAt, qrSecret },
    );
    expect(ok.html).not.toContain('class="watermark"');
    expect(ok.html).toContain('T1');
    const c = await renderTemplate(
      'order-confirmation',
      { brnch: 1, oc: { ...oc, status: 'CANCELLED' }, breakdown, overridden: [], terms: [] },
      { runAt, qrSecret },
    );
    expect(c.html).toContain('class="watermark"><span>CANCELLED');
  });
});

describe('DC + gate pass print (BR-EXIT-01)', () => {
  const data = {
    brnch: 1,
    gatePass: {
      gpId: 41,
      dcNo: '17',
      dcType: 'OS',
      vehicleNo: 'TKN-4521',
      transpName: 'Shaheen Goods',
      biltyNo: 'B-778',
      packingType: 'BAG',
      tareKg: 15000,
      grossKg: 50080,
      netKg: 35080,
      varianceKg: 80,
      status: 'INVOICED',
    },
    lines: [
      {
        srNo: 1,
        doNo: '22702003944',
        productCode: 'OPC',
        tons: '35.080',
        plannedBags: 700,
        invoiceId: 9,
      },
    ],
    dc: {
      dcDate: '2026-11-23',
      bagDesc: 'DEWAN PB',
      bagSupplier: 'Pakland',
      containerNo: null,
      sealNo: null,
    },
    customer: { code: '912-351', name: 'MASHALLAH RICE MILL', address: 'Karachi' },
    destination: '95 Larkana',
    invoices: [{ invoiceId: 9, invoiceNo: '8445', fbrInvoiceNo: null }],
    terms: [],
  };
  it('signed gate-pass QR for the exit scan, DC barcode, lines and weights', async () => {
    const out = await renderTemplate('delivery-challan', data, { runAt, qrSecret });
    expect(out.html).toContain('No. 17.1');
    expect(out.html).toContain('95 Larkana');
    expect(out.html).toContain('35.080');
    expect(out.html).toContain('pending');
    await expect(verifyQr(out.qrPayload, qrSecret)).resolves.toMatchObject({
      ok: true,
      doc: { docType: 'GP', brnch: 1, docNo: '41' },
    });
    expect(out.html).not.toContain('class="watermark"');
  });
  it('BR-DC-CXL-01: an aborted gate pass prints CANCELLED', async () => {
    const out = await renderTemplate(
      'delivery-challan',
      { ...data, gatePass: { ...data.gatePass, status: 'ABORTED' } },
      { runAt, qrSecret },
    );
    expect(out.html).toContain('class="watermark"><span>CANCELLED');
  });
});

describe('sales tax invoice print (BR-TAX-08, BR-QR-04)', () => {
  const invoice = {
    invoiceNo: '8445',
    invoiceDate: '2026-11-23',
    status: 'FBR_ACCEPTED',
    dcType: 'OS',
    dcNo: '175002',
    doNo: '22702003944',
    vehicleNo: 'TKN-4521',
    productCode: 'OPC',
    priceCode: 'SKYOP2',
    destArea: '95',
    buyer: {
      code: '912-351',
      name: 'MASHALLAH RICE MILL',
      address: 'Karachi',
      ntn: '7387041-3',
      strn: null,
    },
    qtyTon: '35.000',
    ratePerTon: '24300.00',
    retailExcl: '757898.31',
    fed: '140000.00',
    fedPerTon: '4000.00',
    retailValue: '897898.31',
    stPct: '18',
    salesTax: '161621.60',
    taxInclusiveValue: '1059519.91',
    saleProceeds: '850500.00',
    valueExcl: '548878.40',
    rateExclPerTon: '15682.24',
    whtPct: '0.1',
    wht: '850.50',
    totalCollectable: '851350.50',
    fbrInvoiceNo: '0712345DI1700000000123',
    fbrQrData: '0712345DI1700000000123',
  };
  const seller = {
    name: 'Dewan Cement Limited',
    ntn: '0712345-6',
    strn: '12-34',
    address: 'Dhabeji',
  };
  it('Part A and Part B of invoice 8445, FBR number with its QR and our signed QR', async () => {
    const out = await renderTemplate(
      'sales-invoice',
      { brnch: 1, seller, invoice },
      { runAt, qrSecret },
    );
    for (const v of [
      '757,898.31',
      '897,898.31',
      '161,621.60',
      '1,059,519.91',
      '548,878.40',
      '15,682.24',
      '850.50',
      '851,350.50',
    ])
      expect(out.html).toContain(v);
    expect(out.html).toContain('0712345DI1700000000123');
    expect((out.html.match(/<svg/g) ?? []).length).toBeGreaterThanOrEqual(2);
    await expect(verifyQr(out.qrPayload, qrSecret)).resolves.toMatchObject({
      ok: true,
      doc: { docType: 'INV', docNo: '8445' },
    });
  });
  it('FBR pending is said; a cancelled invoice prints CANCELLED', async () => {
    const pending = await renderTemplate(
      'sales-invoice',
      {
        brnch: 1,
        seller,
        invoice: { ...invoice, status: 'FINAL', fbrInvoiceNo: null, fbrQrData: null },
      },
      { runAt, qrSecret },
    );
    expect(pending.html).toContain('FBR invoice number pending');
    const c = await renderTemplate(
      'sales-invoice',
      { brnch: 1, seller, invoice: { ...invoice, status: 'CANCELLED' } },
      { runAt, qrSecret },
    );
    expect(c.html).toContain('class="watermark"><span>CANCELLED');
  });
});
