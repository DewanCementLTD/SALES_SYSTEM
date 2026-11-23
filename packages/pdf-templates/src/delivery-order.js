// Delivery Order print (REQUIREMENTS_SPEC 8, BR-DO-03, BR-QR-01): customer, price code, quantity,
// product, DO type, issue date, instructions, DO-number barcode, signed QR, terms from PRINT_TEXT
// (DO_TERMS; never invented), CANCELLED watermark on a cancelled DO.
import { displayDate, formatAmount, signQr } from '@dcl/shared';
import { barcodeSvg, qrSvg } from './codes.js';
import { html, raw } from './html.js';
import { footerTemplate, page } from './letterhead.js';

const d = (v) => (v ? displayDate(`${v}T00:00:00+05:00`) : '—');

/** @param {{ brnch: number, do: any, terms: string[] }} data */
async function deliveryOrder(data, { runAt, qrSecret }) {
  const o = data.do;
  const qr = await signQr(
    { docType: 'DO', brnch: data.brnch, docNo: `${o.doType}-${o.doNo}`, ver: o.qrVer ?? 1 },
    qrSecret,
  );
  const body = html`
    <div class="grid" style="margin-top:10px">
      <div>
        <span class="muted">Customer</span><br /><b>${o.customerCode} ${o.customerName ?? ''}</b
        ><br />${o.customerAddress ?? ''}
      </div>
      <div>
        <span class="muted">Date of issue</span><br />${d(o.issueDate)}<br /><span class="muted"
          >OC # ${o.ocNo ?? '—'} · schedule ${d(o.schedDate)}</span
        >
      </div>
    </div>
    <table style="margin-top:12px">
      <thead>
        <tr>
          <th>Product</th>
          <th>DO type</th>
          <th>Price code</th>
          <th>Destination</th>
          <th>Quantity type</th>
          <th class="num">Quantity</th>
          <th class="num">M.Tonnes</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${o.productCode ?? ''}</td>
          <td>${o.doType}${o.doTypeName ? ` · ${o.doTypeName}` : ''}</td>
          <td>${o.priceCode ?? '—'}</td>
          <td>${o.destName ?? '—'}</td>
          <td>${o.qtyType ?? 'BAGS'}</td>
          <td class="num">${o.bags ?? '—'}</td>
          <td class="num">${formatAmount(o.qtyTon, { decimals: 2 })}</td>
        </tr>
      </tbody>
    </table>
    ${o.instructions ? html`<p><span class="muted">Special instructions:</span> ${o.instructions}</p>` : ''}
    <h2>Terms and conditions</h2>
    ${
      data.terms?.length
        ? data.terms.map((t) => html`<p style="margin:0 0 4px">${t}</p>`)
        : html`<p class="muted">Terms text not set up (Admin › Print texts, DO_TERMS).</p>`
    }
    <div class="grid" style="margin-top:20px; align-items:end">
      <div>Prepared by: ${o.createdBy ?? ''}</div>
      <div class="codes">
        <div>${raw(barcodeSvg(o.doNo))}</div>
        <div style="width:110px">${raw(await qrSvg(qr))}</div>
      </div>
    </div>`;
  return {
    title: 'Delivery Order',
    html: page({
      title: 'Delivery Order',
      docNo: `${o.doNo}.${data.brnch}`,
      brnch: data.brnch,
      runAt,
      body,
      watermark: o.status === 'CANCELLED' ? 'CANCELLED' : o.status === 'ON_HOLD' ? 'ON HOLD' : null,
    }),
    footer: footerTemplate(runAt),
    qrPayload: qr,
  };
}

export default deliveryOrder;
