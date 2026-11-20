// Audit trail (BR-AUD-01..03). Written inside the business transaction; insert-only.
import oracledb from 'oracledb';

/**
 * Who/where of a command; built once per request (lib/context.js).
 * @typedef {{ userId?: number|null, usrid?: string|null, brnch?: number|null, ip?: string|null, requestId?: string|null }} AuditCtx
 */

const SECRET_KEY = /pass(word)?|secret|token|hash|totp/i;

/** Remove secrets and mask CNIC middle digits before storing (CLAUDE.md rule 13). */
export function redact(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) out[k] = '[redacted]';
      else if (/cnic/i.test(k) && typeof v === 'string') out[k] = maskCnic(v);
      else out[k] = redact(v);
    }
    return out;
  }
  return value;
}

export function maskCnic(cnic) {
  const d = String(cnic).replace(/\D/g, '');
  if (d.length !== 13) return '[masked]';
  return `${d.slice(0, 5)}-*******-${d.slice(12)}`;
}

const json = (v) =>
  v === undefined || v === null ? null : { type: oracledb.CLOB, val: JSON.stringify(redact(v)) };

/**
 * BR-AUD-01: one row per event.
 * @param {import('../../lib/oracle/db.js').Tx} tx
 * @param {AuditCtx} ctx
 * @param {{ entity: string, key: string|number, action: string, reason?: string|null, oldValues?: unknown, newValues?: unknown, brnch?: number|null }} ev
 */
export async function recordAudit(tx, ctx, ev) {
  const id = await tx.nextId('SEQ_AUDIT_LOG');
  await tx.exec(
    `INSERT INTO AUDIT_LOG
       (AUDIT_ID, USER_ID, USRID, BRNCH, IP, REQUEST_ID, ENTITY, ENTITY_KEY, ACTION, REASON, OLD_VALUES, NEW_VALUES)
     VALUES (:id, :userId, :usrid, :brnch, :ip, :rid, :entity, :ekey, :action, :reason, :oldv, :newv)`,
    {
      id,
      userId: ctx.userId ?? null,
      usrid: ctx.usrid ?? null,
      brnch: ev.brnch ?? ctx.brnch ?? null,
      ip: ctx.ip ?? null,
      rid: ctx.requestId ?? null,
      entity: ev.entity.slice(0, 30),
      ekey: String(ev.key).slice(0, 200),
      action: ev.action.slice(0, 30),
      reason: ev.reason ? String(ev.reason).slice(0, 1000) : null,
      oldv: json(ev.oldValues),
      newv: json(ev.newValues),
    },
  );
  return id;
}
