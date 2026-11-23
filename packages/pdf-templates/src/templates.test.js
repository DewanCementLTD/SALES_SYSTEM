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
