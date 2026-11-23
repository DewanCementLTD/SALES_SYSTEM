// Weighing (BUSINESS_RULES §11.2 BR-WGT; TASKS P3-05). Every reading becomes a WEIGH_TICKET
// (insert-only, BR-WGT-07): from the agent (a signed DEVICE_READING, single use) or entered by hand
// (weigh.manual + reason, SOURCE MANUAL, BR-WGT-02). Tare first, gross second (BR-WGT-03); net and
// variance against the planned weight (BR-WGT-04); outside the tolerance the truck is blocked until
// it is re-weighed or a supervisor override is approved (BR-WGT-05, WEIGHT_OVERRIDE); the net is
// split over the DC lines (BR-WGT-06). Invoice finalisation follows the gross (P3-06).
import { allocateKg, checkTransition, dec, tareWarning, varianceOf } from '@dcl/shared';
import { Errors } from '../../lib/errors.js';
import { onApproved, onRejected, requestApproval } from '../approvals/service.js';
import { recordAudit } from '../audit/service.js';
import { SettingsReader } from '../settings/service.js';
import { getGatePass } from './gate.js';
import { tryFinalise } from './invoice.js';
import { getReading } from './readings.js';

const ENTITY = 'GATE_PASS';

async function lockGatePass(tx, gpId) {
  const l = await tx.one('SELECT GP_ID FROM GATE_PASS WHERE GP_ID = :id FOR UPDATE', { id: gpId });
  if (!l) throw Errors.notFound(`Gate pass ${gpId}`);
  return getGatePass(tx, gpId);
}

function assertState(gp, to) {
  const t = checkTransition('GATE_PASS', gp.status, to);
  if (!t.ok) throw Errors.invalidState(`Gate pass ${gp.gpId} is ${gp.status}: ${t.detail}`);
}

/**
 * One WEIGH_TICKET from an agent reading or a manual weight.
 * @param {{ deviceId?: string, readingId?: string, weightKg?: number, reason?: string }} src
 */
async function ticket(tx, actor, gp, weighType, src) {
  let row;
  if (src.readingId) {
    const r = await getReading(tx, gp.brnch, src.deviceId, src.readingId);
    if (!r) throw Errors.rule('BR-WGT-01', 'No reading with this id from this weighbridge');
    const used = await tx.one(
      'SELECT GP_ID FROM WEIGH_TICKET WHERE DEVICE_ID = :d AND DEVICE_READING_ID = :r',
      { d: r.deviceId, r: r.readingId },
    );
    if (used)
      throw Errors.duplicate(`This reading was already used (gate pass ${used.GP_ID})`, {
        data: { gpId: Number(used.GP_ID) },
      });
    row = {
      kg: r.weightKg,
      source: 'DEVICE',
      deviceId: r.deviceId,
      readingId: r.readingId,
      readOn: r.readOn,
      reason: null,
    };
  } else {
    // BR-WGT-02: the route checked weigh.manual and the reason
    row = {
      kg: src.weightKg,
      source: 'MANUAL',
      deviceId: null,
      readingId: null,
      readOn: actor.now,
      reason: src.reason,
    };
  }
  const ticketId = await tx.nextId('SEQ_WEIGH_TICKET');
  await tx.exec(
    `INSERT INTO WEIGH_TICKET (TICKET_ID, BRNCH, GP_ID, WEIGH_TYPE, WEIGHT_KG, SOURCE, DEVICE_ID,
       DEVICE_READING_ID, STABLE, READ_ON, RECEIVED_ON, REASON, ENTERED_BY)
     VALUES (:id, :b, :gp, :t, :kg, :src, :dev, :rd, 'Y', :ro, :now, :rs, :u)`,
    {
      id: ticketId,
      b: gp.brnch,
      gp: gp.gpId,
      t: weighType,
      kg: row.kg,
      src: row.source,
      dev: row.deviceId,
      rd: row.readingId,
      ro: row.readOn,
      now: actor.now,
      rs: row.reason,
      u: actor.usrid,
    },
  );
  return { ticketId, ...row };
}

const bump = (tx, actor, gp, sets) => {
  const cols = Object.keys(sets);
  const binds = { id: gp.gpId, rv: gp.rowVer, u: actor.usrid, now: actor.now };
  cols.forEach((c, i) => {
    binds[`x${i}`] = sets[c];
  });
  return tx
    .exec(
      `UPDATE GATE_PASS SET ROW_VER = ROW_VER + 1, UPDATED_BY = :u, UPDATED_ON = :now
         ${cols.map((c, i) => `, ${c} = :x${i}`).join('')}
       WHERE GP_ID = :id AND ROW_VER = :rv`,
      binds,
    )
    .then((n) => {
      if (n !== 1) throw Errors.versionConflict();
    });
};

/** POST /plant/gate-passes/{gpId}/tare */
export async function captureTare(tx, actor, gpId, src) {
  const gp = await lockGatePass(tx, gpId);
  assertState(gp, 'TARE_DONE');
  const t = await ticket(tx, actor, gp, 'TARE', src);
  const last = await tx.one(
    `SELECT TARE_KG FROM (SELECT TARE_KG FROM GATE_PASS WHERE BRNCH = :b AND VEHICLE_NO = :v
        AND TARE_KG IS NOT NULL AND GP_ID <> :id ORDER BY TARE_ON DESC) WHERE ROWNUM = 1`,
    { b: gp.brnch, v: gp.vehicleNo, id: gp.gpId },
  );
  const warnKg = await new SettingsReader(tx).num(gp.brnch, 'TARE_WARN_KG');
  const warning = tareWarning(t.kg, last ? Number(last.TARE_KG) : null, warnKg);
  await bump(tx, actor, gp, {
    STATUS: 'TARE_DONE',
    TARE_TICKET_ID: t.ticketId,
    TARE_KG: t.kg,
    TARE_ON: actor.now,
  });
  if (gp.dcNo)
    await tx.exec(
      `UPDATE FH_DELIVERY_CHALLAN SET W_TARE = :kg, DOC_STATUS = 'ISSUED', UPDATED_BY = :u, UPDATED_ON = :now
        WHERE BRNCH = :b AND DC_TYPE = :t AND DC_NO = :n`,
      { kg: t.kg, u: actor.usrid, now: actor.now, b: gp.brnch, t: gp.dcType, n: gp.dcNo },
    );
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: String(gp.gpId),
    action: t.source === 'MANUAL' ? 'TARE_MANUAL' : 'TARE',
    brnch: gp.brnch,
    reason: t.reason,
    newValues: { tareKg: t.kg, source: t.source, ticketId: t.ticketId, warning },
  });
  return { gatePass: await getGatePass(tx, gp.gpId), warnings: warning ? [warning] : [] };
}

/**
 * POST …/gross (after the tare) and …/reweigh (a new gross while the variance blocks the truck,
 * BR-WGT-05; the earlier gross stays in WEIGH_TICKET).
 */
export async function captureGross(tx, actor, gpId, src, { reweigh = false } = {}) {
  const gp = await lockGatePass(tx, gpId);
  if (reweigh && gp.status !== 'VARIANCE_BLOCKED')
    throw Errors.invalidState(
      `Gate pass ${gp.gpId} is ${gp.status}: re-weigh is for a blocked variance`,
    );
  if (!reweigh && gp.status !== 'TARE_DONE') assertState(gp, 'GROSS_DONE');
  const t = await ticket(tx, actor, gp, 'GROSS', src);
  if (t.kg <= gp.tareKg)
    throw Errors.rule('BR-WGT-03', `Gross ${t.kg} kg must be more than the tare ${gp.tareKg} kg`);
  const netKg = t.kg - gp.tareKg;
  const tol = (await new SettingsReader(tx).num(gp.brnch, 'WEIGHT_TOLERANCE_KG')) ?? 100;
  const v = varianceOf(netKg, gp.plannedKg ?? 0, tol);
  const status = v.withinTolerance ? 'GROSS_DONE' : 'VARIANCE_BLOCKED';
  await bump(tx, actor, gp, {
    STATUS: status,
    GROSS_TICKET_ID: t.ticketId,
    GROSS_KG: t.kg,
    GROSS_ON: actor.now,
    NET_KG: netKg,
    VARIANCE_KG: v.varianceKg,
    VARIANCE_PCT: v.variancePct,
    VARIANCE_STATUS: v.withinTolerance ? 'OK' : 'BLOCKED',
  });
  // BR-WGT-04: DC weight = net; BR-WGT-06: net split over the DC lines
  if (gp.dcNo) {
    const parts = allocateKg(
      netKg,
      gp.lines.map((l) => dec(l.plannedTon).times(1000).round().toNumber()),
    );
    for (let i = 0; i < gp.lines.length; i += 1) {
      await tx.exec(
        `UPDATE FH_DEL_CHALLAN_DETAIL SET ALLOC_NET_KG = :kg, LINE_STATUS = 'WEIGHED'
          WHERE BRNCH = :b AND DC_TYPE = :t AND DC_NO = :n AND DCD_SNO = :sr`,
        { kg: parts[i], b: gp.brnch, t: gp.dcType, n: gp.dcNo, sr: gp.lines[i].srNo },
      );
    }
    await tx.exec(
      `UPDATE FH_DELIVERY_CHALLAN SET WT_GROSS = :g, NET_KG = :net, VARIANCE_KG = :v,
         QTY_VERIFIED = :t, DOC_STATUS = 'WEIGHED', UPDATED_BY = :u, UPDATED_ON = :now
        WHERE BRNCH = :b AND DC_TYPE = :dt AND DC_NO = :n`,
      {
        g: t.kg,
        net: netKg,
        v: v.varianceKg,
        t: dec(netKg).dividedBy(1000).toFixed(2),
        u: actor.usrid,
        now: actor.now,
        b: gp.brnch,
        dt: gp.dcType,
        n: gp.dcNo,
      },
    );
  }
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: String(gp.gpId),
    action: `${reweigh ? 'REWEIGH' : 'GROSS'}${t.source === 'MANUAL' ? '_MANUAL' : ''}`,
    brnch: gp.brnch,
    reason: t.reason,
    newValues: { grossKg: t.kg, netKg, ...v, source: t.source, ticketId: t.ticketId },
  });
  // BR-INV-01: variance OK → invoices at once
  const fin = v.withinTolerance
    ? await tryFinalise(tx, actor, gp.gpId)
    : { invoices: [], invoiceProblem: null };
  return {
    ...fin,
    gatePass: await getGatePass(tx, gp.gpId),
    net: netKg,
    variance: v.varianceKg,
    variancePct: v.variancePct,
    direction: v.direction,
    varianceStatus: v.withinTolerance ? 'OK' : 'BLOCKED',
    toleranceKg: tol,
  };
}

async function applyOverride(tx, actor, gp, requestId) {
  await bump(tx, actor, gp, {
    STATUS: 'OVERRIDDEN',
    VARIANCE_STATUS: 'OVERRIDDEN',
    WEIGHT_OVR_REQ_ID: requestId,
  });
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: String(gp.gpId),
    action: 'WEIGHT_OVERRIDE',
    brnch: gp.brnch,
    newValues: { varianceKg: gp.varianceKg, requestId },
  });
  // BR-INV-01: an approved override finalises the invoices
  return tryFinalise(tx, actor, gp.gpId);
}

/** POST …/request-weight-override (BR-WGT-05): approval WEIGHT_OVERRIDE, or at once without a rule. */
export async function requestWeightOverride(tx, actor, gpId, reason) {
  const gp = await lockGatePass(tx, gpId);
  assertState(gp, 'OVERRIDDEN');
  const res = await requestApproval(
    tx,
    { ...actor.audit, now: actor.now },
    {
      brnch: gp.brnch,
      docType: 'WEIGHT_OVERRIDE',
      docKey: String(gp.gpId),
      action: 'WEIGHT_OVERRIDE',
      snapshot: {
        vehicleNo: gp.vehicleNo,
        dcNo: gp.dcNo,
        plannedKg: gp.plannedKg,
        netKg: gp.netKg,
        varianceKg: gp.varianceKg,
        variancePct: gp.variancePct,
        reason,
      },
      qty: String(Math.abs(gp.varianceKg ?? 0)),
      reason,
    },
  );
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: String(gp.gpId),
    action: 'REQUEST_WEIGHT_OVERRIDE',
    brnch: gp.brnch,
    reason,
    newValues: { requestId: res.requestId ?? null },
  });
  const fin = res.required
    ? { invoices: [], invoiceProblem: null }
    : await applyOverride(tx, actor, gp, null);
  return {
    ...fin,
    gatePass: await getGatePass(tx, gp.gpId),
    requestId: res.required ? res.requestId : null,
  };
}

onApproved('WEIGHT_OVERRIDE', async (tx, req, ctx) => {
  const gp = await lockGatePass(tx, Number(req.docKey));
  if (gp.status !== 'VARIANCE_BLOCKED') return; // re-weighed meanwhile
  await applyOverride(tx, { usrid: ctx.usrid, now: ctx.now, audit: ctx }, gp, req.reqId ?? null);
});
onRejected('WEIGHT_OVERRIDE', async () => {});
