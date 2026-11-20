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
