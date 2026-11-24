// Offline sync (BUSINESS_RULES BR-OFF-01…04; TASKS P3-10). Events are applied in order, each in its
// own transaction through the same services as the online screens (DC numbers are allocated here,
// never offline — BR-OFF-03). A replay of a client id returns the stored result (BR-OFF-04). A
// business failure (DO cancelled meanwhile, vehicle busy, …) is recorded in SYNC_CONFLICT for the
// dispatch supervisor, who retries it after fixing the data or discards it.
import { syncPermission } from '@dcl/shared';
import { AppError, Errors } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import { exitGate } from './exit.js';
import { gateIn } from './gate.js';
import { captureGross, captureTare } from './weighing.js';

async function gpOf(tx, brnch, ref) {
  const r = ref.gpId
    ? await tx.one('SELECT GP_ID, BRNCH FROM GATE_PASS WHERE GP_ID = :id', { id: ref.gpId })
    : await tx.one('SELECT GP_ID, BRNCH FROM GATE_PASS WHERE CLIENT_ID = :c', {
        c: ref.gpClientId,
      });
  if (!r || Number(r.BRNCH) !== brnch)
    throw Errors.rule(
      'BR-OFF-04',
      'The gate pass of this event is not known (its gate-in did not sync)',
    );
  return Number(r.GP_ID);
}

/** Apply one event; returns its result. */
async function applyOne(tx, actor, brnch, ev) {
  const { type, payload } = ev;
  if (type === 'GATE_IN') {
    const gp = await gateIn(tx, actor, brnch, { ...payload, clientId: ev.clientId });
    return { gpId: gp.gpId, dcNo: gp.dcNo, status: gp.status };
  }
  const gpId = await gpOf(tx, brnch, payload);
  const src =
    'weightKg' in payload
      ? { weightKg: payload.weightKg, reason: payload.reason }
      : { deviceId: payload.deviceId, readingId: payload.readingId };
  if (type === 'TARE') {
    const r = await captureTare(tx, actor, gpId, src);
    return { gpId, tareKg: r.gatePass.tareKg, warnings: r.warnings };
  }
  if (type === 'GROSS') {
    const r = await captureGross(tx, actor, gpId, src);
    return {
      gpId,
      netKg: r.net,
      variance: r.variance,
      varianceStatus: r.varianceStatus,
      invoices: r.invoices.map((i) => i.invoiceNo),
      invoiceProblem: r.invoiceProblem,
    };
  }
  const gp = await exitGate(tx, actor, gpId);
  return { gpId, status: gp.status };
}

const problemOf = (e) => ({
  code: e.code,
  detail: e.detail ?? e.message,
  ruleId: e.ruleId ?? null,
});

/**
 * POST /plant/sync. `may(permission)` tells whether the caller holds a permission in the branch.
 * @param {import('../../lib/oracle/db.js').Db} db
 */
export async function pushEvents(db, { actor, brnch, may, isDevice, deviceType, txOpts }, events) {
  const out = [];
  for (const ev of events) {
    const seen = await db.read(
      (tx) =>
        tx.one('SELECT STATUS, RESULT, CONFLICT_ID FROM SYNC_EVENT WHERE CLIENT_ID = :c', {
          c: ev.clientId,
        }),
      txOpts,
    );
    if (seen) {
      out.push({
        clientId: ev.clientId,
        status: 'DUPLICATE',
        result: seen.RESULT ? JSON.parse(seen.RESULT) : null,
        conflictId: seen.CONFLICT_ID === null ? null : Number(seen.CONFLICT_ID),
      });
      continue;
    }
    const need = syncPermission(ev);
    const allowed = isDevice
      ? deviceType === 'GATE' && ['GATE_IN', 'EXIT'].includes(ev.type)
      : may(need);
    const deviceTime = Number.isNaN(Date.parse(ev.deviceTime)) ? null : new Date(ev.deviceTime);
    try {
      if (!allowed) throw Errors.forbidden(`You need ${need} to push ${ev.type}`);
      const result = await db.withTx(async (tx) => {
        const r = await applyOne(tx, actor, brnch, ev);
        await tx.exec(
          `INSERT INTO SYNC_EVENT (CLIENT_ID, BRNCH, EVENT_TYPE, STATUS, RESULT, DEVICE_ID, USRID, DEVICE_TIME, RECEIVED_ON)
           VALUES (:c, :b, :t, 'APPLIED', :r, :dev, :u, :dt, :now)`,
          {
            c: ev.clientId,
            b: brnch,
            t: ev.type,
            r: JSON.stringify(r),
            dev: actor.deviceId ?? null,
            u: actor.usrid,
            dt: deviceTime,
            now: actor.now,
          },
        );
        return r;
      }, txOpts);
      out.push({ clientId: ev.clientId, status: 'APPLIED', result });
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      const conflictId = await db.withTx(async (tx) => {
        const id = await tx.nextId('SEQ_SYNC_CONFLICT');
        await tx.exec(
          `INSERT INTO SYNC_CONFLICT (CONFLICT_ID, BRNCH, DEVICE_ID, CLIENT_ID, EVENT_TYPE, PAYLOAD, DEVICE_TIME,
             ERROR_CODE, ERROR_MSG, STATUS, CREATED_ON)
           VALUES (:id, :b, :dev, :c, :t, :p, :dt, :ec, :em, 'OPEN', :now)`,
          {
            id,
            b: brnch,
            dev: actor.deviceId ?? null,
            c: ev.clientId,
            t: ev.type,
            p: JSON.stringify(ev.payload),
            dt: deviceTime,
            ec: String(e.ruleId ?? e.code).slice(0, 50),
            em: String(e.detail ?? e.message).slice(0, 2000),
            now: actor.now,
          },
        );
        await tx.exec(
          `INSERT INTO SYNC_EVENT (CLIENT_ID, BRNCH, EVENT_TYPE, STATUS, CONFLICT_ID, DEVICE_ID, USRID, DEVICE_TIME, RECEIVED_ON)
           VALUES (:c, :b, :t, 'CONFLICT', :id, :dev, :u, :dt, :now)`,
          {
            c: ev.clientId,
            b: brnch,
            t: ev.type,
            id,
            dev: actor.deviceId ?? null,
            u: actor.usrid,
            dt: deviceTime,
            now: actor.now,
          },
        );
        return id;
      }, txOpts);
      out.push({ clientId: ev.clientId, status: 'CONFLICT', conflictId, error: problemOf(e) });
    }
  }
  return out;
}

function mapConflict(r) {
  return {
    conflictId: Number(r.CONFLICT_ID),
    brnch: Number(r.BRNCH),
    deviceId: r.DEVICE_ID ?? null,
    clientId: r.CLIENT_ID,
    eventType: r.EVENT_TYPE,
    payload: JSON.parse(r.PAYLOAD),
    deviceTime: r.DEVICE_TIME ?? null,
    errorCode: r.ERROR_CODE,
    errorMsg: r.ERROR_MSG ?? null,
    status: r.STATUS,
    resolution: r.RESOLUTION ?? null,
    resolvedBy: r.RESOLVED_BY ?? null,
    resolvedOn: r.RESOLVED_ON ?? null,
    createdOn: r.CREATED_ON,
  };
}

export async function listConflicts(tx, brnch, status) {
  const rows = await tx.many(
    `SELECT * FROM SYNC_CONFLICT WHERE BRNCH = :b AND (:st IS NULL OR STATUS = :st)
      ORDER BY CREATED_ON DESC, CONFLICT_ID DESC`,
    { b: brnch, st: status ?? null },
    { maxRows: 200 },
  );
  return rows.map(mapConflict);
}

/**
 * POST /plant/sync-conflicts/{id}/resolve (sync.resolve): RETRY applies the event again with the
 * supervisor as the user; DISCARD closes it. Either way the reason is kept.
 */
export async function resolveConflict(tx, actor, brnch, conflictId, { action, resolution }) {
  const r = await tx.one('SELECT * FROM SYNC_CONFLICT WHERE CONFLICT_ID = :id FOR UPDATE', {
    id: conflictId,
  });
  if (!r || Number(r.BRNCH) !== brnch) throw Errors.notFound(`Sync conflict ${conflictId}`);
  if (r.STATUS !== 'OPEN') throw Errors.invalidState(`Conflict ${conflictId} is ${r.STATUS}`);
  const c = mapConflict(r);
  let result = null;
  if (action === 'RETRY') {
    result = await applyOne(tx, actor, brnch, {
      clientId: c.clientId,
      type: c.eventType,
      payload: c.payload,
    });
    await tx.exec(`UPDATE SYNC_EVENT SET STATUS = 'APPLIED', RESULT = :r WHERE CLIENT_ID = :c`, {
      r: JSON.stringify(result),
      c: c.clientId,
    });
  }
  await tx.exec(
    `UPDATE SYNC_CONFLICT SET STATUS = :st, RESOLUTION = :res, RESOLVED_BY = :u, RESOLVED_ON = :now
      WHERE CONFLICT_ID = :id`,
    {
      st: action === 'RETRY' ? 'RESOLVED' : 'DISCARDED',
      res: resolution.slice(0, 1000),
      u: actor.usrid,
      now: actor.now,
      id: conflictId,
    },
  );
  await recordAudit(tx, actor.audit, {
    entity: 'SYNC_CONFLICT',
    key: String(conflictId),
    action: action === 'RETRY' ? 'RESOLVE' : 'DISCARD',
    brnch,
    reason: resolution,
    newValues: { result },
  });
  return {
    conflict: mapConflict(
      await tx.one('SELECT * FROM SYNC_CONFLICT WHERE CONFLICT_ID = :id', { id: conflictId }),
    ),
    result,
  };
}
