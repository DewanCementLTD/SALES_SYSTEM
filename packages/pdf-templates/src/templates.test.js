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
