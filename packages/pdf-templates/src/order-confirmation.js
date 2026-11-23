// Order Confirmation print (PRD 4.4, BR-OC-03): customer, product, quantity, price breakdown with
// override marks (BR-OC-02), schedule, linked BRVs, DOs created; terms from PRINT_TEXT OC_TERMS
// (never invented). DRAFT watermark until approved, CANCELLED on a cancelled OC.
import { OC_PRICE_LABELS, displayDate, formatAmount } from '@dcl/shared';
import { html } from './html.js';
import { footerTemplate, page } from './letterhead.js';

const d = (v) => (v ? displayDate(`${v}T00:00:00+05:00`) : '—');
const PRICE_ROWS = [
  'retailPrice',
  'tradeDisc',
  'tradeDiscPrice',
  'salesTax',
  'fed',
  'consPrice',
  'expense',
  'discount',
  'netPrice',
];

/** @param {{ brnch: number, oc: any, breakdown: Record<string,string>, overridden: string[], terms: string[] }} data */
async function orderConfirmation(data, { runAt }) {
  const o = data.oc;
  const over = new Set(data.overridden ?? []);
  const body = html`
    <div class="grid" style="margin-top:10px">
      <div>
        <span class="muted">Customer</span><br /><b>${o.customerCode} ${o.customerName ?? ''}</b>
      </div>
      <div>
        <span class="muted">OC date / status</span><br />${d(o.orderDate)} · ${o.status}
        <br /><span class="muted">SRF # ${o.srfNo ?? '—'}</span>
      </div>
      <div>
        <span class="muted">Product / destination</span><br />${o.productCode} ·
        ${o.destName ?? '—'}${o.priceCode ? html` · price code ${o.priceCode}` : ''}
      </div>
      <div>
        <span class="muted">Quantity</span><br />${formatAmount(o.qtyTon, { decimals: 2 })} t
      </div>
    </div>
    <h2>Price per ton (PKR)</h2>
    <table>
      <tbody>
        ${PRICE_ROWS.map(
          (k) =>
            html`<tr>
              <td>${OC_PRICE_LABELS[k]}${over.has(k) ? ' *' : ''}</td>
              <td class="num">${formatAmount(data.breakdown[k])}</td>
            </tr>`,
        )}
        <tr>
          <td><b>OC value</b></td>
          <td class="num"><b>${formatAmount(data.breakdown.value)}</b></td>
        </tr>
      </tbody>
    </table>
    ${
      over.size
        ? html`<p class="muted">
          * differs from the trade price${
            o.priceOverride === 'A' ? ' (override approved)' : ' (override pending)'
          }
        </p>`
        : ''
    }
    <h2>Schedule</h2>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Date</th>
          <th class="num">Qty (t)</th>
        </tr>
      </thead>
      <tbody>
        ${o.schedule.map(
          (s) =>
            html`<tr>
              <td>${s.srNo}</td>
              <td>${d(s.date)}</td>
              <td class="num">${formatAmount(s.qtyTon, { decimals: 2 })}</td>
            </tr>`,
        )}
      </tbody>
    </table>
    ${
      o.brvs?.length
        ? html`<h2>Payments linked</h2>
          <table>
            <thead>
              <tr>
                <th>BRV #</th>
                <th>Date</th>
                <th>Cheque</th>
                <th class="num">Applied (PKR)</th>
              </tr>
            </thead>
            <tbody>
              ${o.brvs.map(
                (b) =>
                  html`<tr>
                    <td>${b.receiptNo}</td>
                    <td>${d(b.brvDate)}</td>
                    <td>${b.chequeNo ?? '—'}</td>
                    <td class="num">${formatAmount(b.amount)}</td>
                  </tr>`,
              )}
            </tbody>
          </table>`
        : ''
    }
    ${
      o.dos?.length
        ? html`<h2>Delivery orders</h2>
          <table>
            <thead>
              <tr>
                <th>DO #</th>
                <th>Type</th>
                <th>Schedule</th>
                <th class="num">Qty (t)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${o.dos.map(
                (x) =>
                  html`<tr>
                    <td>${x.doNo}.${data.brnch}</td>
                    <td>${x.doType}</td>
                    <td>${d(x.schedDate)}</td>
                    <td class="num">${formatAmount(x.qtyTon, { decimals: 2 })}</td>
                    <td>${x.status}</td>
                  </tr>`,
              )}
            </tbody>
          </table>`
        : ''
    }
    ${o.remarks ? html`<p><span class="muted">Remarks:</span> ${o.remarks}</p>` : ''}
    <h2>Terms and conditions</h2>
    ${
      data.terms?.length
        ? data.terms.map((t) => html`<p style="margin:0 0 4px">${t}</p>`)
        : html`<p class="muted">Terms text not set up (Admin › Print texts, OC_TERMS).</p>`
    }
    <div class="grid" style="margin-top:24px">
      <div>Prepared by: ${o.createdBy ?? ''}</div>
      <div>Approved by: ${o.approvedBy ?? '—'}</div>
    </div>`;
  const draft = ['DRAFT', 'REVIEWED', 'REJECTED'].includes(o.status);
  return {
    title: 'Order Confirmation',
    html: page({
      title: 'Order Confirmation',
      docNo: `${o.ocNo}.${data.brnch}`,
      brnch: data.brnch,
      runAt,
      body,
      watermark: o.status === 'CANCELLED' ? 'CANCELLED' : draft ? 'DRAFT' : null,
    }),
    footer: footerTemplate(runAt),
  };
}

export default orderConfirmation;
