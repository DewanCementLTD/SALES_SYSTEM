// Permit print (REQUIREMENTS_SPEC 7.1, BR-PMT-04, BR-QR-01): permit no, date, customer, product,
// quantity, area grid, signed QR; terms from PRINT_TEXT PERMIT_TERMS (48-hour wording, never
// invented); CANCELLED watermark.
import { displayDate, formatAmount, signQr } from '@dcl/shared';
import { qrSvg } from './codes.js';
import { html, raw } from './html.js';
import { footerTemplate, page } from './letterhead.js';

const d = (v) => (v ? displayDate(`${v}T00:00:00+05:00`) : '—');

/** @param {{ brnch: number, permit: any, terms: string[] }} data */
async function permit(data, { runAt, qrSecret }) {
  const p = data.permit;
  const qr = await signQr(
    { docType: 'PMT', brnch: data.brnch, docNo: p.permitNo, ver: p.qrVer ?? 1 },
    qrSecret,
  );
  const areas = p.areas.filter((a) => a.status !== 'CANCELLED');
  const body = html`
    <div class="grid" style="margin-top:10px">
      <div>
        <span class="muted">Customer</span><br /><b>${p.customerCode} ${p.customerName ?? ''}</b>
      </div>
      <div>
        <span class="muted">Permit date / valid from</span><br />${d(p.permitDate)} /
        ${d(p.validFrom)}${p.validTo ? html` · valid to ${d(p.validTo)}` : ''}
      </div>
      <div><span class="muted">Product</span><br />${p.productCode}</div>
      <div>
        <span class="muted">Permit quantity</span><br />${formatAmount(p.qtyTon, { decimals: 3 })} t
      </div>
    </div>
    <table style="margin-top:12px">
      <thead>
        <tr>
          <th>Area / city</th>
          <th class="num">Qty (t)</th>
          <th class="num">Rate</th>
          <th class="num">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${areas.map(
          (a) =>
            html`<tr>
              <td>${a.areaName ?? a.areaDoc} (${a.areaDoc})</td>
              <td class="num">${formatAmount(a.qtyTon, { decimals: 3 })}</td>
              <td class="num">${formatAmount(a.rate)}</td>
              <td class="num">${formatAmount(a.amount)}</td>
            </tr>`,
        )}
      </tbody>
    </table>
    <h2>Terms and conditions</h2>
    ${
      data.terms?.length
        ? data.terms.map((t) => html`<p style="margin:0 0 4px">${t}</p>`)
        : html`<p class="muted">Terms text not set up (Admin › Print texts, PERMIT_TERMS).</p>`
    }
    <div class="codes" style="margin-top:18px">
      <div style="width:110px">${raw(await qrSvg(qr))}</div>
    </div>`;
  return {
    title: 'City Wise Permit',
    html: page({
      title: 'City Wise Permit',
      docNo: p.permitNo,
      brnch: data.brnch,
      runAt,
      body,
      watermark: p.status === 'CANCELLED' ? 'CANCELLED' : null,
    }),
    footer: footerTemplate(runAt),
    qrPayload: qr,
  };
}

export default permit;
