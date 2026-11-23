// Print templates registry. Each template: (data, { runAt }) → Promise<{ html, title, footer }>.
// Document templates (DO, permit, DC, invoice, CRF, notes, reports) are added by their phases.
import { signQr } from '@dcl/shared';
import { barcodeSvg, qrSvg } from './codes.js';
import { html, raw } from './html.js';
import brvReceipt from './brv-receipt.js';
import contractReview from './contract-review.js';
import deliveryOrder from './delivery-order.js';
import orderConfirmation from './order-confirmation.js';
import permit from './permit.js';
import { footerTemplate, page } from './letterhead.js';

export { html, raw, escapeHtml } from './html.js';
export { page, footerTemplate, BASE_CSS } from './letterhead.js';
export { qrSvg, barcodeSvg } from './codes.js';
export { CRF_CLAUSES } from './contract-review.js';

/**
 * Layout check page: letterhead, a table, a signed QR and a barcode (used by the PDF self-test
 * and as the starting point for document templates).
 */
async function sample(data, { runAt, qrSecret }) {
  const payload = await signQr(
    { docType: 'DO', brnch: data.brnch, docNo: data.docNo, ver: 1 },
    qrSecret,
  );
  const body = html` <h2>Layout check</h2>
    <div class="grid">
      <div><span class="muted">Customer</span><br />${data.customer}</div>
      <div><span class="muted">Branch</span><br />.${data.brnch}</div>
    </div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Item</th>
          <th class="num">Qty (t)</th>
          <th class="num">Amount (PKR)</th>
        </tr>
      </thead>
      <tbody>
        ${data.lines.map(
          (l, i) =>
            html`<tr>
              <td>${i + 1}</td>
              <td>${l.item}</td>
              <td class="num">${l.qty}</td>
              <td class="num">${l.amount}</td>
            </tr>`,
        )}
      </tbody>
    </table>
    <div class="codes" style="margin-top:18px">
      <div>${raw(barcodeSvg(data.docNo))}</div>
      <div style="width:110px">${raw(await qrSvg(payload))}</div>
    </div>`;
  return {
    title: 'Sample',
    html: page({
      title: 'Sample document',
      docNo: data.docNo,
      brnch: data.brnch,
      runAt,
      body,
      watermark: data.cancelled ? 'CANCELLED' : null,
    }),
    footer: footerTemplate(runAt),
    qrPayload: payload,
  };
}

export const TEMPLATES = {
  sample,
  'contract-review': contractReview,
  'brv-receipt': brvReceipt,
  'delivery-order': deliveryOrder,
  'order-confirmation': orderConfirmation,
  permit,
};

/** Render a registered template to HTML. */
export async function renderTemplate(name, data, opts) {
  const t = TEMPLATES[name];
  if (!t) throw new Error(`Unknown print template ${name}`);
  return t(data, opts);
}
