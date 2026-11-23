// Delivery Challan + gate pass print (REQUIREMENTS_SPEC 9.1, BR-DC-03, BR-EXIT-01; TASKS P3-11):
// customer, destination, vehicle, transporter, bilty, DC type, packing, bags, container/seal, DO
// lines (tons, bags), weights, invoices with their FBR numbers, DC-number barcode and the signed
// gate-pass QR the exit gate scans. Terms from PRINT_TEXT DC_TERMS (never invented). CANCELLED
// watermark on an aborted / cancelled DC.
import { displayDate, formatAmount, signQr } from '@dcl/shared';
import { barcodeSvg, qrSvg } from './codes.js';
import { html, raw } from './html.js';
import { footerTemplate, page } from './letterhead.js';

const d = (v) => (v ? displayDate(`${v}T00:00:00+05:00`) : '—');
const kg = (v) => (v === null || v === undefined ? '—' : `${formatAmount(v, { decimals: 0 })} kg`);

/** @param {{ brnch: number, gatePass: any, lines: any[], dc: any, customer: any, destination: string|null, invoices: any[], terms: string[] }} data */
async function deliveryChallan(data, { runAt, qrSecret }) {
  const g = data.gatePass;
  const qr = await signQr(
    { docType: 'GP', brnch: data.brnch, docNo: String(g.gpId), ver: 1 },
    qrSecret,
  );
  const totalTon = data.lines.reduce((s, l) => s + Number(l.tons ?? 0), 0);
  const totalBags = data.lines.reduce((s, l) => s + Number(l.plannedBags ?? 0), 0);
  const body = html`
    <div class="grid" style="margin-top:10px">
      <div>
        <span class="muted">Customer</span><br /><b>${data.customer.code} ${data.customer.name ?? ''}</b
        ><br />${data.customer.address ?? ''}
      </div>
      <div>
        <span class="muted">DC date / destination</span><br />${d(data.dc.dcDate)} ·
        ${data.destination ?? '—'}<br /><span class="muted">Gate pass ${g.gpId}</span>
      </div>
      <div>
        <span class="muted">Vehicle / transporter</span><br />${g.vehicleNo} ·
        ${g.transpName ?? g.transpCode ?? '—'}<br /><span class="muted">Bilty ${g.biltyNo ?? '—'}</span>
      </div>
      <div>
        <span class="muted">DC type / packing</span><br />${g.dcType} ·
        ${g.packingType === 'BULK' ? 'Bulker' : 'Bags'}<br /><span class="muted"
          >Bags: ${data.dc.bagDesc ?? '—'}${data.dc.bagSupplier ? ` · ${data.dc.bagSupplier}` : ''}</span
        >
      </div>
    </div>
    ${
      data.dc.containerNo || data.dc.sealNo
        ? html`<p><span class="muted">Container</span> ${data.dc.containerNo ?? '—'} ·
          <span class="muted">Seal</span> ${data.dc.sealNo ?? '—'}</p>`
        : ''
    }
    <table style="margin-top:12px">
      <thead>
        <tr>
          <th>S#</th>
          <th>DO #</th>
          <th>Product</th>
          <th class="num">M.Tonnes</th>
          <th class="num">Bags</th>
          <th>Invoice</th>
          <th>FBR</th>
        </tr>
      </thead>
      <tbody>
        ${data.lines.map((l) => {
          const inv = data.invoices.find((i) => i.invoiceId === l.invoiceId);
          return html`<tr>
            <td>${l.srNo}</td>
            <td>${l.doNo}</td>
            <td>${l.productCode ?? ''}</td>
            <td class="num">${formatAmount(l.tons, { decimals: 3 })}</td>
            <td class="num">${l.plannedBags ?? '—'}</td>
            <td>${inv?.invoiceNo ?? '—'}</td>
            <td>${inv?.fbrInvoiceNo ?? (inv ? 'pending' : '—')}</td>
          </tr>`;
        })}
        <tr>
          <td colspan="3"><b>Total</b></td>
          <td class="num"><b>${formatAmount(totalTon, { decimals: 3 })}</b></td>
          <td class="num"><b>${totalBags || '—'}</b></td>
          <td colspan="2"></td>
        </tr>
      </tbody>
    </table>
    <p>
      <span class="muted">Tare</span> ${kg(g.tareKg)} · <span class="muted">Gross</span>
      ${kg(g.grossKg)} · <span class="muted">Net</span> ${kg(g.netKg)}${
        g.varianceKg !== null
          ? html` · <span class="muted">Variance</span> ${g.varianceKg > 0 ? '+' : ''}${g.varianceKg} kg`
          : ''
      }
    </p>
    ${data.dc.remarks ? html`<p><span class="muted">Remarks:</span> ${data.dc.remarks}</p>` : ''}
    ${data.terms?.length ? data.terms.map((t) => html`<p style="margin:0 0 4px">${t}</p>`) : ''}
    <div class="grid" style="margin-top:20px; align-items:end">
      <div>Supervisor: ____________________ <br /><span class="muted">DC stamp</span></div>
      <div class="codes">
        <div>${raw(barcodeSvg(String(g.dcNo)))}</div>
        <div style="width:110px">${raw(await qrSvg(qr))}<br /><span class="muted">Exit pass</span></div>
      </div>
    </div>`;
  return {
    title: 'Delivery Challan',
    html: page({
      title: 'Delivery Challan',
      docNo: `${g.dcNo}.${data.brnch}`,
      brnch: data.brnch,
      runAt,
      body,
      watermark: g.status === 'ABORTED' ? 'CANCELLED' : null,
    }),
    footer: footerTemplate(runAt),
    qrPayload: qr,
  };
}

export default deliveryChallan;
