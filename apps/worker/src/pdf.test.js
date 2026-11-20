import { renderTemplate } from '@dcl/pdf-templates';
import { afterAll, describe, expect, it } from 'vitest';
import { closeBrowser, renderPdf } from './pdf.js';

afterAll(closeBrowser);

describe('PDF rendering (P0-15)', () => {
  it('renders the sample template to an A4 PDF with Chromium', async () => {
    const runAt = new Date('2026-11-20T06:30:00Z');
    const doc = await renderTemplate(
      'sample',
      {
        brnch: 1,
        docNo: '22746000013',
        customer: 'Test customer',
        lines: [{ item: 'OPC', qty: '40.000', amount: '972,000.00' }],
      },
      { runAt, qrSecret: 'test-qr-secret-0001' },
    );
    const pdf = await renderPdf(doc);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5_000);
  }, 60_000);

  it('blocks network access from templates', async () => {
    const pdf = await renderPdf({
      html: '<html><body><img src="http://example.com/x.png">ok</body></html>',
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  }, 60_000);
});
