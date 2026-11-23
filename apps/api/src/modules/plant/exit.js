// Exit (BUSINESS_RULES BR-EXIT-01…03; TASKS P3-08). The gate scans the gate-pass QR on the DC
// (P3-11 prints it) or opens the gate pass, then: every DC line invoiced, variance OK or overridden,
// an FBR invoice number on every invoice. FBR still pending → blocked, unless ALLOW_EXIT_WITHOUT_FBR
// = Y and an EXIT_WITHOUT_FBR override was approved (supervisor, reason). Exit records time and user,
// closes the gate pass (EXITED) and tells the dealer (TRUCK_EXITED).
import { businessDate, dec } from '@dcl/shared';
import { Errors } from '../../lib/errors.js';
import { loadRequest, onApproved, onRejected, requestApproval } from '../approvals/service.js';
import { recordAudit } from '../audit/service.js';
import { notifyDealer } from '../notifications/dealer.js';
import { SettingsReader } from '../settings/service.js';
import { getGatePass } from './gate.js';
import { invoicesOf } from './invoice.js';

const ENTITY = 'GATE_PASS';

async function lockGatePass(tx, gpId) {
  const l = await tx.one('SELECT GP_ID FROM GATE_PASS WHERE GP_ID = :id FOR UPDATE', { id: gpId });
  if (!l) throw Errors.notFound(`Gate pass ${gpId}`);
  return getGatePass(tx, gpId);
}

/**
 * BR-EXIT-02 checklist. `fbrPendingOnly` = only FBR numbers are missing (the override case).
 * @returns {Promise<{ ok: boolean, missing: string[], fbrPendingOnly: boolean, invoices: any[] }>}
 */
export async function exitChecklist(tx, gp) {
  const invoices = await invoicesOf(tx, gp.gpId);
  const missing = [];
  if (!['INVOICED'].includes(gp.status))
    missing.push(`Gate pass is ${gp.status.toLowerCase()}, not invoiced`);
  const notInvoiced = gp.lines.filter((l) => l.status !== 'INVOICED');
  if (notInvoiced.length)
    missing.push(`DC lines not invoiced: DO ${notInvoiced.map((l) => l.doNo).join(', ')}`);
  if (!['OK', 'OVERRIDDEN'].includes(gp.varianceStatus ?? ''))
    missing.push(`Weight variance is ${gp.varianceStatus ?? 'not weighed'}`);
  const noFbr = invoices.filter((i) => !i.fbrInvoiceNo);
  const fbrMissing = noFbr.length
    ? `No FBR invoice number yet: invoice ${noFbr.map((i) => i.invoiceNo).join(', ')}`
    : null;
  return {
    ok: missing.length === 0 && !fbrMissing,
    missing: fbrMissing ? [...missing, fbrMissing] : missing,
    fbrPendingOnly: missing.length === 0 && Boolean(fbrMissing),
    invoices,
  };
}

/** POST /plant/gate-passes/{gpId}/exit */
export async function exitGate(tx, actor, gpId) {
  const gp = await lockGatePass(tx, gpId);
  if (gp.status === 'EXITED') throw Errors.invalidState(`Truck ${gp.vehicleNo} has already left`);
  const c = await exitChecklist(tx, gp);
  let override = null;
  if (!c.ok) {
    const allowed = await new SettingsReader(tx).bool(gp.brnch, 'ALLOW_EXIT_WITHOUT_FBR');
    const req = gp.exitOvrReqId ? await loadRequest(tx, gp.exitOvrReqId) : null;
    if (c.fbrPendingOnly && allowed && req?.status === 'APPROVED') override = req.reqId;
    else
      throw Errors.rule('BR-EXIT-02', `Exit is not allowed yet: ${c.missing.join('; ')}`, {
        missing: c.missing,
        fbrPendingOnly: c.fbrPendingOnly,
        overrideAllowed: c.fbrPendingOnly && allowed,
      });
  }
  const n = await tx.exec(
    `UPDATE GATE_PASS SET STATUS = 'EXITED', EXIT_ON = :now, EXIT_BY = :u, ROW_VER = ROW_VER + 1,
       UPDATED_BY = :u, UPDATED_ON = :now WHERE GP_ID = :id AND ROW_VER = :rv`,
    { now: actor.now, u: actor.usrid, id: gp.gpId, rv: gp.rowVer },
  );
  if (n !== 1) throw Errors.versionConflict();
  if (gp.dcNo)
    await tx.exec(
      `UPDATE FH_DELIVERY_CHALLAN SET DOC_STATUS = 'CLOSED', UPDATED_BY = :u, UPDATED_ON = :now
        WHERE BRNCH = :b AND DC_TYPE = :t AND DC_NO = :n`,
      { u: actor.usrid, now: actor.now, b: gp.brnch, t: gp.dcType, n: gp.dcNo },
    );
  const qty = c.invoices.reduce((s, i) => s.plus(dec(i.qtyTon)), dec(0));
  const product = await tx.one(
    `SELECT MIN(PRODUCT_CODE) AS P FROM SALES_INVOICE WHERE GP_ID = :g`,
    { g: gp.gpId },
  );
  // BR-EXIT-03 / BR-NTF-01
  await notifyDealer(tx, {
    brnch: gp.brnch,
    event: 'TRUCK_EXITED',
    docKey: String(gp.gpId),
    customerCode: gp.customerCode,
    vars: {
      VEHICLE_NO: gp.vehicleNo,
      QTY: qty.toFixed(2),
      PRODUCT: product?.P ?? '',
      DC_NO: `${gp.dcNo}.${gp.brnch}`,
      INVOICES: c.invoices.map((i) => i.invoiceNo).join(', '),
      DATE: businessDate(actor.now),
    },
    now: actor.now,
  });
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: String(gp.gpId),
    action: override ? 'EXIT_OVERRIDE' : 'EXIT',
    brnch: gp.brnch,
    newValues: { exitOn: actor.now, override },
  });
  return getGatePass(tx, gp.gpId);
}

/** POST …/request-exit-override (gate.exit_override): only FBR missing and the setting on (OPEN-Q3). */
export async function requestExitOverride(tx, actor, gpId, reason) {
  const gp = await lockGatePass(tx, gpId);
  const c = await exitChecklist(tx, gp);
  if (c.ok) throw Errors.invalidState('Nothing to override: the truck may leave');
  if (!c.fbrPendingOnly)
    throw Errors.rule(
      'BR-EXIT-02',
      `Only a pending FBR number can be overridden: ${c.missing.join('; ')}`,
    );
  // OPEN-Q3: exit without FBR is off by default (ALLOW_EXIT_WITHOUT_FBR = N)
  if (!(await new SettingsReader(tx).bool(gp.brnch, 'ALLOW_EXIT_WITHOUT_FBR')))
    throw Errors.rule(
      'BR-EXIT-02',
      'Exit without an FBR number is not allowed (ALLOW_EXIT_WITHOUT_FBR = N)',
    );
  const res = await requestApproval(
    tx,
    { ...actor.audit, now: actor.now },
    {
      brnch: gp.brnch,
      docType: 'EXIT_WITHOUT_FBR',
      docKey: String(gp.gpId),
      action: 'EXIT_WITHOUT_FBR',
      snapshot: { vehicleNo: gp.vehicleNo, dcNo: gp.dcNo, missing: c.missing, reason },
      reason,
    },
  );
  await tx.exec('UPDATE GATE_PASS SET EXIT_OVR_REQ_ID = :r WHERE GP_ID = :id', {
    r: res.required ? res.requestId : null,
    id: gp.gpId,
  });
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: String(gp.gpId),
    action: 'REQUEST_EXIT_OVERRIDE',
    brnch: gp.brnch,
    reason,
    newValues: { requestId: res.requestId ?? null },
  });
  if (!res.required)
    throw Errors.rule(
      'BR-EXIT-02',
      'No approval rule EXIT_WITHOUT_FBR is active: the override needs one',
    );
  return { gatePass: await getGatePass(tx, gp.gpId), requestId: res.requestId };
}

// The approval itself is the override; the gate operator then lets the truck out.
onApproved('EXIT_WITHOUT_FBR', async () => {});
onRejected('EXIT_WITHOUT_FBR', async (tx, req) => {
  await tx.exec(
    'UPDATE GATE_PASS SET EXIT_OVR_REQ_ID = NULL WHERE GP_ID = :id AND EXIT_OVR_REQ_ID = :r',
    {
      id: Number(req.docKey),
      r: req.reqId,
    },
  );
});
