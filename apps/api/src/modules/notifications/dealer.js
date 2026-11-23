// Dealer notifications (BUSINESS_RULES §17 BR-NTF-01/02, TASKS P2-09). Called inside the event's
// transaction: one NOTIFICATION_OUTBOX row per channel the customer accepts (CUSTOMER_INFO
// NOTIFY_SMS / NOTIFY_WA / NOTIFY_EMAIL), text from MSG_TEMPLATE (branch row wins over the company
// row; PK is (TEMPLATE_CODE, CHANNEL), so a branch variant is stored as code '<CODE>@<brnch>'),
// deduplicated per event + document + channel (no duplicate SMS for one event).
import { enqueue } from '../outbox/service.js';

/** Dealer events and their template codes. */
export const DEALER_EVENTS = Object.freeze([
  'BRV_VERIFIED',
  'DO_ISSUED',
  'PERMIT_ISSUED',
  'TRUCK_EXITED',
]);
const CHANNEL_OF = { SMS: 'SMS', WA: 'WHATSAPP', EMAIL: 'EMAIL' };

/** `Dear {CUSTOMER_NAME}` + { CUSTOMER_NAME: 'X' } → `Dear X` (unknown placeholders stay visible). */
export function renderTemplate(text, vars) {
  return String(text ?? '').replace(/\{([A-Z_]+)\}/g, (m, k) =>
    vars[k] === undefined || vars[k] === null ? m : String(vars[k]),
  );
}

async function templates(tx, brnch, code) {
  const rows = await tx.many(
    `SELECT CHANNEL, SUBJECT, BODY, TEMPLATE_CODE FROM MSG_TEMPLATE
      WHERE TEMPLATE_CODE IN (:c, :cb) AND NVL(ACTIVE, 'Y') = 'Y'
      ORDER BY CASE WHEN TEMPLATE_CODE = :c THEN 0 ELSE 1 END`,
    { c: code, cb: `${code}@${brnch}` },
  );
  const out = {};
  for (const r of rows) out[r.CHANNEL] = { subject: r.SUBJECT ?? null, body: r.BODY }; // branch row last → wins
  return out;
}

/**
 * Queue the dealer messages of an event. `channels` limits the channels (resend); by default the
 * customer's preferences decide. Returns the outbox ids.
 * @param {import('../../lib/oracle/db.js').Tx} tx
 * @param {{ brnch: number, event: string, docKey: string, customerCode: string,
 *   vars: Record<string, any>, now: Date, channels?: string[], resend?: boolean }} e
 */
export async function notifyDealer(tx, e) {
  const c = await tx.one(
    `SELECT CUSTOMER_NAME, MOBILE_NO, WHATSAPP_NO, EMAIL, NOTIFY_SMS, NOTIFY_WA, NOTIFY_EMAIL
       FROM CUSTOMER_INFO WHERE BRNCH = :b AND CUSTOMER_CODE = :c`,
    { b: e.brnch, c: e.customerCode },
  );
  if (!c) return [];
  const tpl = await templates(tx, e.brnch, e.event);
  const wants = {
    SMS: c.NOTIFY_SMS === 'Y' && c.MOBILE_NO,
    WA: c.NOTIFY_WA === 'Y' && (c.WHATSAPP_NO || c.MOBILE_NO),
    EMAIL: c.NOTIFY_EMAIL === 'Y' && c.EMAIL,
  };
  const to = { SMS: c.MOBILE_NO, WA: c.WHATSAPP_NO ?? c.MOBILE_NO, EMAIL: c.EMAIL };
  const vars = { CUSTOMER_NAME: c.CUSTOMER_NAME, CUSTOMER_CODE: e.customerCode, ...e.vars };
  const ids = [];
  for (const ch of ['SMS', 'WA', 'EMAIL']) {
    const channel = CHANNEL_OF[ch];
    if (e.channels ? !e.channels.includes(channel) || !to[ch] : !wants[ch]) continue;
    const t = tpl[ch];
    if (!t) continue; // no template for this channel → nothing to send
    const r = await enqueue(tx, {
      brnch: e.brnch,
      eventType: e.event,
      aggregateType: 'DEALER',
      aggregateKey: e.docKey,
      channel,
      recipient: String(to[ch]),
      dedupKey: `${e.event}|${e.docKey}|${channel}${e.resend ? `|${e.now.getTime()}` : ''}`,
      payload: {
        text: renderTemplate(t.body, vars),
        subject: t.subject ? renderTemplate(t.subject, vars) : null,
        customerCode: e.customerCode,
      },
      now: e.now,
    });
    if (!r.duplicate) ids.push(r.outboxId);
  }
  return ids;
}
