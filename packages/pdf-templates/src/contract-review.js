// Contract Review Form (REQUIREMENTS_SPEC 5.1, BR-SRF-07): a print of the SRF, document
// DCL/MKT/FM/003. Clause texts come from PRINT_TEXT (per branch, edited by admin); the print
// never invents clause wording: a missing clause is shown as "not set up".
import { displayDate, formatAmount } from '@dcl/shared';
import { html } from './html.js';
import { footerTemplate, page } from './letterhead.js';

const d = (v) => (v ? displayDate(`${v}T00:00:00+05:00`) : '—');

/** Clause headings of the form, in print order (text code → heading). */
export const CRF_CLAUSES = Object.freeze([
  ['CRF_DELIVERY_TIME', 'Delivery time'],
  ['CRF_PAYMENT', 'Payment method'],
  ['CRF_VALIDITY', 'Contract validity'],
  ['CRF_PACKING', 'Packing'],
  ['CRF_ESCALATION', 'Escalation'],
]);

/**
 * @param {{ brnch: number, srf: any, customer: any, productName?: string, transportName?: string,
 *   control?: { docNo?: string, issueDate?: string, revision?: string, revisionDate?: string },
 *   clauses: Record<string, string[]>, preparedBy?: string, approvedBy?: string|null }} data
 */
async function contractReview(data, { runAt }) {
  const { srf, customer: c } = data;
  const ctl = data.control ?? {};
  const clause = (code) => {
    const lines = data.clauses?.[code] ?? [];
    if (!lines.length)
      return html`<span class="muted">Clause text not set up (Admin › Print texts).</span>`;
    return lines.map(
      (l) =>
        html`<p style="margin:0 0 4px">${l.replaceAll('{validTo}', d(srf.contractValidTo))}</p>`,
    );
  };
  const body = html`
    <table style="margin-top:8px">
      <tr>
        <th>Doc #</th>
        <td>${ctl.docNo ?? 'DCL/MKT/FM/003'}</td>
        <th>Issue date</th>
        <td>${ctl.issueDate ?? '—'}</td>
        <th>Revision #</th>
        <td>${ctl.revision ?? '—'}</td>
        <th>Revision date</th>
        <td>${ctl.revisionDate ?? '—'}</td>
      </tr>
    </table>
    <div class="grid" style="margin-top:10px">
      <div><span class="muted">SRF #</span><br />${srf.srfNo}</div>
      <div><span class="muted">SRF date</span><br />${d(srf.srfDate)}</div>
      <div>
        <span class="muted">Parties</span><br />Dewan Cement Limited and ${srf.customerCode}
        ${srf.customerName ?? ''}
      </div>
      <div>
        <span class="muted">Effective</span><br />${d(srf.srfDate)} to ${d(srf.contractValidTo)}
      </div>
    </div>
    <h2>Customer</h2>
    <div class="grid">
      <div><span class="muted">Name</span><br />${c.customerName ?? srf.customerName ?? ''}</div>
      <div><span class="muted">Contact no.</span><br />${c.mobile ?? c.phone ?? '—'}</div>
      <div><span class="muted">E-mail</span><br />${c.email ?? '—'}</div>
      <div>
        <span class="muted">Postal address</span><br />${
          [c.address1, c.address2].filter(Boolean).join(', ') || '—'
        }
      </div>
    </div>
    <h2>Order</h2>
    <table>
      <thead>
        <tr>
          <th>Product</th>
          <th class="num">Quantity (t)</th>
          <th class="num">Bags</th>
          <th>Delivery mode</th>
          <th>Transport</th>
          <th>Destination</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${srf.productCode}${data.productName ? ` · ${data.productName}` : ''}</td>
          <td class="num">${formatAmount(srf.qtyTon)}</td>
          <td class="num">${srf.bags ?? '—'}</td>
          <td>${srf.modeOfDelivery === 'BULK' ? 'Bulker' : 'Bags'}</td>
          <td>${data.transportName ?? srf.modeOfTransport ?? '—'}</td>
          <td>${srf.destName ?? srf.destGeoCode ?? '—'}</td>
        </tr>
      </tbody>
    </table>
    <h2>Terms</h2>
    <table>
      <tbody>
        ${CRF_CLAUSES.map(
          ([code, heading]) =>
            html`<tr>
              <th style="width:28%">${heading}</th>
              <td>${clause(code)}</td>
            </tr>`,
        )}
        <tr>
          <th>Legal requirements</th>
          <td>${srf.legalRequirements ?? '—'}</td>
        </tr>
        <tr>
          <th>Remarks / comments</th>
          <td>${srf.crRemarks ?? srf.specialInstructions ?? '—'}</td>
        </tr>
      </tbody>
    </table>
    <div class="grid" style="margin-top:36px">
      <div>
        <div style="border-top:1px solid #0f1f33; width:70%; padding-top:4px">
          Prepared by: ${data.preparedBy ?? srf.createdBy ?? ''}
        </div>
      </div>
      <div>
        <div style="border-top:1px solid #0f1f33; width:70%; padding-top:4px">
          Approved by: ${data.approvedBy ?? ''}
        </div>
      </div>
    </div>`;
  return {
    title: 'Contract Review Form',
    html: page({
      title: 'Contract Review Form',
      docNo: srf.srfNo,
      brnch: data.brnch,
      runAt,
      body,
      watermark: srf.status === 'CANCELLED' ? 'CANCELLED' : null,
    }),
    footer: footerTemplate(runAt),
  };
}

export default contractReview;
