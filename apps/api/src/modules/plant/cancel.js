// Abort and DC cancel (BUSINESS_RULES BR-DC-CXL-01…03; TASKS P3-09).
// - abort (gate.abort, reason): truck not loaded, before any invoice: gate pass ABORTED, DC and its
//   lines CANCELLED (the DC number stays used), nothing posted.
// - DC cancel after invoice, before FBR accepted (dc.cancel + approval DC_CANCEL): invoices
//   CANCELLED (numbers not reused), DC-ledger rows reversed, DO dispatched quantity restored, DC
//   CANCELLED, gate pass ABORTED (the truck is unloaded inside the plant).
// - an invoice with an FBR number: no cancel; a credit note (type 004, sales return) instead.
import { dec, fiscalYearOf, businessDate, reversalEntry } from '@dcl/shared';
import { Errors } from '../../lib/errors.js';
import { onApproved, onRejected, requestApproval } from '../approvals/service.js';
import { recordAudit } from '../audit/service.js';
import { getDo } from '../do/service.js';
import * as ledger from '../ledger/service.js';
import { getGatePass } from './gate.js';

const ENTITY = 'GATE_PASS';

async function lockGatePass(tx, gpId) {
  const l = await tx.one('SELECT GP_ID FROM GATE_PASS WHERE GP_ID = :id FOR UPDATE', { id: gpId });
  if (!l) throw Errors.notFound(`Gate pass ${gpId}`);
  return getGatePass(tx, gpId);
}

async function cancelDcRows(tx, actor, gp, reason) {
  if (!gp.dcNo) return;
  const k = { b: gp.brnch, t: gp.dcType, n: gp.dcNo };
  await tx.exec(
    `UPDATE FH_DELIVERY_CHALLAN SET DOC_STATUS = 'CANCELLED', CANCEL_CODE = 'Y', CANCEL_FLAG = 'Y',
       CANCEL_REASON = :r, CANCELLED_BY = :u, CANCELLED_ON = :now, CANCEL_DATE = :cd,
       ROW_VER = ROW_VER + 1, UPDATED_BY = :u, UPDATED_ON = :now
      WHERE BRNCH = :b AND DC_TYPE = :t AND DC_NO = :n`,
    { ...k, r: reason.slice(0, 500), u: actor.usrid, now: actor.now, cd: businessDate(actor.now) },
  );
  await tx.exec(
    `UPDATE FH_DEL_CHALLAN_DETAIL SET LINE_STATUS = 'CANCELLED', CANCEL_FLAG = 'Y', CANCEL_DATE = :cd
      WHERE BRNCH = :b AND DC_TYPE = :t AND DC_NO = :n`,
    { ...k, cd: businessDate(actor.now) },
  );
}

async function closeGatePass(tx, actor, gp, reason) {
  const n = await tx.exec(
    `UPDATE GATE_PASS SET STATUS = 'ABORTED', CANCEL_REASON = :r, ROW_VER = ROW_VER + 1,
       UPDATED_BY = :u, UPDATED_ON = :now WHERE GP_ID = :id AND ROW_VER = :rv`,
    { r: reason.slice(0, 500), u: actor.usrid, now: actor.now, id: gp.gpId, rv: gp.rowVer },
  );
  if (n !== 1) throw Errors.versionConflict();
}

/** BR-DC-CXL-01: POST /plant/gate-passes/{gpId}/abort */
export async function abort(tx, actor, gpId, reason) {
  const gp = await lockGatePass(tx, gpId);
  const invoiced = gp.lines.some((l) => l.invoiceId);
  if (invoiced || ['INVOICED', 'EXITED'].includes(gp.status))
    throw Errors.rule(
      'BR-DC-CXL-01',
      'Invoices exist: cancel the DC instead (approval DC_CANCEL before FBR; credit note after)',
    );
  if (gp.status === 'ABORTED') throw Errors.invalidState(`Gate pass ${gp.gpId} is already aborted`);
  await cancelDcRows(tx, actor, gp, reason);
  await closeGatePass(tx, actor, gp, reason);
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: String(gp.gpId),
    action: 'ABORT',
    brnch: gp.brnch,
    reason,
    newValues: { dcNo: gp.dcNo, status: gp.status },
  });
  return getGatePass(tx, gp.gpId);
}

async function invoicesForCancel(tx, gp) {
  return tx.many(
    `SELECT INVOICE_ID, INVOICE_NO, INVOICE_YEAR, STATUS, FBR_INVOICE_NO, DO_NO, QTY_TON, PRODUCT_CODE
       FROM SALES_INVOICE WHERE GP_ID = :g AND STATUS <> 'CANCELLED' ORDER BY INVOICE_NO FOR UPDATE`,
    { g: gp.gpId },
  );
}

/** BR-DC-CXL-02/03 checks shared by the request and the approved apply. */
async function checkCancellable(tx, gp) {
  const invs = await invoicesForCancel(tx, gp);
  if (!invs.length)
    throw Errors.rule('BR-DC-CXL-01', 'No invoice on this DC: abort the gate pass instead');
  const withFbr = invs.filter((i) => i.FBR_INVOICE_NO);
  if (withFbr.length)
    throw Errors.rule(
      'BR-DC-CXL-03',
      `Invoice ${withFbr.map((i) => i.INVOICE_NO).join(', ')} has an FBR number: issue a credit note (type 004, sales return) instead`,
    );
  // an FBR attempt whose outcome is unknown could still give a number (BR-FBR-05)
  const sent = await tx.one(
    `SELECT COUNT(*) AS N FROM FBR_SUBMISSION s WHERE s.INVOICE_ID IN (SELECT INVOICE_ID FROM SALES_INVOICE WHERE GP_ID = :g)
        AND s.RESULT = 'SENT'`,
    { g: gp.gpId },
  );
  if (Number(sent.N) > 0)
    throw Errors.rule(
      'BR-DC-CXL-03',
      'An FBR submission is in progress or its outcome is unknown: check the FBR portal first',
    );
  return invs;
}

async function applyCancel(tx, actor, gp, reason, requestId) {
  const invs = await checkCancellable(tx, gp);
  for (const inv of invs) {
    await tx.exec(
      `UPDATE SALES_INVOICE SET STATUS = 'CANCELLED', CANCEL_REASON = :r, CANCELLED_BY = :u,
         CANCELLED_ON = :now, ROW_VER = ROW_VER + 1 WHERE INVOICE_ID = :id`,
      { r: reason.slice(0, 500), u: actor.usrid, now: actor.now, id: inv.INVOICE_ID },
    );
    // DC-ledger sale and WHT reversed (the DO-ledger memo row has no amount)
    const rows = await ledger.documentRows(tx, {
      brnch: gp.brnch,
      docType: 'INV',
      docNo: String(inv.INVOICE_NO),
      docYear: Number(inv.INVOICE_YEAR),
    });
    const reversed = new Set(rows.filter((r) => r.reversalOf).map((r) => r.reversalOf));
    const open = rows.filter(
      (r) => !r.reversalOf && !reversed.has(r.ledgerId) && r.entryKind !== 'MEMO',
    );
    if (open.length)
      await ledger.post(
        tx,
        actor,
        open.map((r) =>
          reversalEntry(r, {
            entryDate: businessDate(actor.now),
            narration: `Cancelled INV # ${inv.INVOICE_NO} · DC # ${gp.dcNo}`,
          }),
        ),
      );
    // DO dispatched quantity back
    const line = gp.lines.find((l) => l.invoiceId === Number(inv.INVOICE_ID));
    if (inv.DO_NO && line) {
      const d = await getDo(tx, gp.brnch, line.doType, String(inv.DO_NO), { forUpdate: true });
      const left = dec(d.dispatchedTon).minus(dec(inv.QTY_TON));
      const disp = left.isNegative() ? dec(0) : left;
      await tx.exec(
        `UPDATE DELIVERY_ORDER SET DISPATCHED_TON = :dt, DISPATCHED = :dr, ROW_VER = ROW_VER + 1,
           DOC_STATUS = CASE WHEN DOC_STATUS IN ('CANCELLED', 'ON_HOLD') THEN DOC_STATUS
                             WHEN :dt > 0 THEN 'PARTLY_DISPATCHED' ELSE 'ISSUED' END,
           UPDATED_BY = :u, UPDATED_ON = :now
          WHERE BRNCH = :b AND DO_TYPE = :t AND DEL_ORDER_NO = :n`,
        {
          dt: disp.toFixed(3),
          dr: disp.toDecimalPlaces(2).toNumber(),
          u: actor.usrid,
          now: actor.now,
          b: gp.brnch,
          t: d.doType,
          n: d.doNo,
        },
      );
    }
  }
  await cancelDcRows(tx, actor, gp, reason);
  await closeGatePass(tx, actor, gp, reason);
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: String(gp.gpId),
    action: 'DC_CANCEL',
    brnch: gp.brnch,
    reason,
    newValues: {
      dcNo: gp.dcNo,
      invoices: invs.map((i) => String(i.INVOICE_NO)),
      requestId,
      year: fiscalYearOf(actor.now),
    },
  });
}

/** POST /plant/dc/{brnch}/{dcType}/{dcNo}/cancel: approval DC_CANCEL, or at once without a rule. */
export async function requestDcCancel(tx, actor, { brnch, dcType, dcNo }, reason) {
  const g = await tx.one(
    'SELECT GP_ID FROM FH_DELIVERY_CHALLAN WHERE BRNCH = :b AND DC_TYPE = :t AND DC_NO = :n',
    { b: brnch, t: dcType, n: dcNo },
  );
  if (!g?.GP_ID) throw Errors.notFound(`DC ${dcType} ${dcNo}`);
  const gp = await lockGatePass(tx, Number(g.GP_ID));
  if (gp.status === 'EXITED')
    throw Errors.rule('BR-DC-CXL-03', 'The truck has left: issue a credit note (type 004) instead');
  const invs = await checkCancellable(tx, gp);
  const res = await requestApproval(
    tx,
    { ...actor.audit, now: actor.now },
    {
      brnch,
      docType: 'DC_CANCEL',
      docKey: String(gp.gpId),
      action: 'DC_CANCEL',
      snapshot: {
        dcType,
        dcNo,
        vehicleNo: gp.vehicleNo,
        invoices: invs.map((i) => String(i.INVOICE_NO)),
        reason,
      },
      reason,
    },
  );
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: String(gp.gpId),
    action: 'REQUEST_DC_CANCEL',
    brnch,
    reason,
    newValues: { requestId: res.requestId ?? null },
  });
  if (!res.required) await applyCancel(tx, actor, gp, reason, null);
  return {
    gatePass: await getGatePass(tx, gp.gpId),
    requestId: res.required ? res.requestId : null,
  };
}

onApproved('DC_CANCEL', async (tx, req, ctx) => {
  const gp = await lockGatePass(tx, Number(req.docKey));
  if (gp.status === 'ABORTED' || gp.status === 'EXITED') return;
  await applyCancel(tx, { usrid: ctx.usrid, now: ctx.now, audit: ctx }, gp, req.reason, req.reqId);
});
onRejected('DC_CANCEL', async () => {});
