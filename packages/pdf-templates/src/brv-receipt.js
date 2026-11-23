// BRV receipt (TASKS P2-04): what the customer paid, how, into which account, and its verification.
import { displayDate, displayDateTime, formatAmount } from '@dcl/shared';
import { html } from './html.js';
import { footerTemplate, page } from './letterhead.js';

const d = (v) => (v ? displayDate(`${v}T00:00:00+05:00`) : '—');
const amt = (v) => (v === null || v === undefined ? '—' : formatAmount(v));

/** @param {{ brnch: number, brv: any }} data */
async function brvReceipt({ brnch, brv }, { runAt }) {
  const row = (k, v) => html`<tr>
    <th style="width:32%">${k}</th>
    <td>${v ?? '—'}</td>
  </tr>`;
  const body = html`
    <div class="grid" style="margin-top:10px">
      <div><span class="muted">BRV #</span><br />${brv.receiptNo}</div>
      <div><span class="muted">Date</span><br />${d(brv.brvDate)}</div>
      <div>
        <span class="muted">Customer</span><br />${brv.customerCode} ${brv.customerName ?? ''}
      </div>
      <div><span class="muted">Status</span><br />${brv.status.toLowerCase()}</div>
    </div>
    <table style="margin-top:12px">
      <tbody>
        ${row('Instrument', brv.instrument ?? brv.instCode)}
        ${row('Cheque / reference', brv.chequeNo)} ${row('Cheque date', d(brv.chequeDate))}
        ${row('Customer bank', brv.bankName ?? brv.bankCode)}
        ${row('Deposited in', brv.depositBank)}
        ${row('Amount (PKR)', html`<b>${amt(brv.amount)}</b>`)}
        ${brv.salesTax && Number(brv.salesTax) ? row('Sales tax', amt(brv.salesTax)) : ''}
        ${brv.tax && Number(brv.tax) ? row('Tax', amt(brv.tax)) : ''}
        ${brv.freight && Number(brv.freight) ? row('Freight', amt(brv.freight)) : ''}
        ${row('Remarks', brv.remarks)}
        ${row(
          'Verified',
          brv.verifiedBy
            ? `${brv.verifiedBy}, ${displayDateTime(brv.verifiedOn)} (${brv.verifyMethod?.toLowerCase().replace('_', ' ')}, ref ${brv.verifyRef})`
            : 'Not verified yet: this receipt does not count toward the balance',
        )}
      </tbody>
    </table>`;
  return {
    title: 'Bank Receipt Voucher',
    html: page({
      title: 'Bank Receipt Voucher',
      docNo: brv.receiptNo,
      brnch,
      runAt,
      body,
      watermark: ['CANCELLED', 'BOUNCED'].includes(brv.status) ? brv.status : null,
    }),
    footer: footerTemplate(runAt),
  };
}

export default brvReceipt;
