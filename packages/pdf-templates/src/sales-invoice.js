// Commercial / Excise / Sales Tax Invoice (REQUIREMENTS_SPEC 9.2/9.3, BR-QR-04, BR-TAX-08; TASKS
// P3-11). Stored figures only: Part A (taxes on the retail price) and Part B (the customer's
// invoice) exactly as invoice 8445. The FBR invoice number with its QR when FBR accepted the
// invoice; our own signed QR (INV) always. CANCELLED watermark on a cancelled invoice.
import { displayDate, formatAmount, signQr } from '@dcl/shared';
import { qrSvg } from './codes.js';
import { html, raw } from './html.js';
import { footerTemplate, page } from './letterhead.js';

const d = (v) => (v ? displayDate(`${v}T00:00:00+05:00`) : '—');
const pkr = (v) => formatAmount(v);

/** @param {{ brnch: number, seller: any, invoice: any }} data */
async function salesInvoice(data, { runAt, qrSecret }) {
  const i = data.invoice;
  const ours = await signQr(
    { docType: 'INV', brnch: data.brnch, docNo: i.invoiceNo, ver: 1 },
    qrSecret,
  );
  const rowsA = [
    ['Tax exclusive value', i.retailExcl],
    [`Federal excise duty (${pkr(i.fedPerTon)}/ton)`, i.fed],
    [`Retail price (code ${i.priceCode ?? '—'})`, i.retailValue],
    [`Sales tax @ ${i.stPct}% on retail price`, i.salesTax],
    ['Tax inclusive value (market price)', i.taxInclusiveValue],
  ];
  const rowsB = [
    ['Qty in tons', null, formatAmount(i.qtyTon, { decimals: 2 })],
    ['Rate per ton (excl. FED and ST)', null, pkr(i.rateExclPerTon)],
    ['Value exclusive', i.valueExcl],
    ['Federal excise duty', i.fed],
    [`Sales tax @ ${i.stPct}% on retail price`, i.salesTax],
    ['Sale proceeds (incl. FED and ST)', i.saleProceeds],
    [`Withholding tax ${i.whtPct}%`, i.wht],
  ];
  const body = html`
    <div class="grid" style="margin-top:10px">
      <div>
        <span class="muted">Seller</span><br /><b>${data.seller.name}</b><br />NTN
        ${data.seller.ntn || '—'} · STRN ${data.seller.strn || '—'}<br />${data.seller.address ?? ''}
      </div>
      <div>
        <span class="muted">Buyer</span><br /><b>${i.buyer.code} ${i.buyer.name ?? ''}</b
        ><br />${i.buyer.address ?? ''}<br />NTN ${i.buyer.ntn ?? '—'} · STRN
        ${i.buyer.strn ?? '—'}${i.buyer.cnic ? html` · CNIC ${i.buyer.cnic}` : ''}
      </div>
      <div>
        <span class="muted">Invoice / date</span><br /><b>${i.invoiceNo}</b> · ${d(i.invoiceDate)}
      </div>
      <div>
        <span class="muted">DC / vehicle / DO</span><br />${i.dcType} ${i.dcNo} · ${i.vehicleNo ?? '—'}
        · ${i.doNo ?? '—'}<br /><span class="muted">Product</span> ${i.productCode} ·
        <span class="muted">destination</span> ${i.destArea ?? '—'}
      </div>
    </div>
    <h2>A. Taxes on retail price</h2>
    <table>
      <tbody>
        ${rowsA.map(
          ([k, v]) => html`<tr>
            <td>${k}</td>
            <td class="num">${pkr(v)}</td>
          </tr>`,
        )}
      </tbody>
    </table>
    <h2>B. Customer invoice</h2>
    <table>
      <tbody>
        ${rowsB.map(
          ([k, v, shown]) => html`<tr>
            <td>${k}</td>
            <td class="num">${shown ?? pkr(v)}</td>
          </tr>`,
        )}
        <tr>
          <td><b>Total collectable</b></td>
          <td class="num"><b>${pkr(i.totalCollectable)}</b></td>
        </tr>
      </tbody>
    </table>
    <div class="grid" style="margin-top:18px; align-items:end">
      <div>
        ${
          i.fbrInvoiceNo
            ? html`<span class="muted">FBR invoice number</span><br /><b>${i.fbrInvoiceNo}</b>`
            : html`<span class="muted">FBR invoice number pending</span>`
        }
      </div>
      <div class="codes">
        ${
          i.fbrQrData
            ? html`<div style="width:96px">${raw(await qrSvg(i.fbrQrData))}<br /><span class="muted">FBR</span></div>`
            : ''
        }
        <div style="width:96px">${raw(await qrSvg(ours))}<br /><span class="muted">DCL</span></div>
      </div>
    </div>`;
  return {
    title: 'Sales Tax Invoice',
    html: page({
      title: 'Commercial / Excise / Sales Tax Invoice',
      docNo: `${i.invoiceNo}.${data.brnch}`,
      brnch: data.brnch,
      runAt,
      body,
      watermark: i.status === 'CANCELLED' ? 'CANCELLED' : null,
    }),
    footer: footerTemplate(runAt),
    qrPayload: ours,
  };
}

export default salesInvoice;
