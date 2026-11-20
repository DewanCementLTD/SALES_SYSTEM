// Approval engine (BR-APR-01..05, TASKS P0-12): maker-checker with 1–3 levels.
// The action waiting for approval runs through a handler registered with `onApproved`, inside the
// SAME transaction as the final approval, so it runs exactly once (double click → invalid_state).
import oracledb from 'oracledb';
import { dec } from '@dcl/shared';
import { Errors } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import { usersWithRole } from '../rbac/repo.js';

/** @typedef {import('../../lib/oracle/db.js').Tx} Tx */
/** @typedef {(tx: Tx, req: ApprovalRequest, ctx: object) => Promise<void>} Handler */
/**
 * @typedef {{ reqId: number, brnch: number, ruleId: number, docType: string, docKey: string, action: string,
 *   snapshot: any, amount: string|null, qty: string|null, reason: string, status: string, currentLevel: number,
 *   levels: number, levelRoles: string[], requestedBy: string, requestedOn: Date, decidedOn: Date|null,
 *   expiresOn: Date|null, rowVer: number, sameUserAllowed: boolean }} ApprovalRequest
 */

const approvedHandlers = new Map();
const rejectedHandlers = new Map();

/** Register what happens when a request of `action` is finally approved. */
export function onApproved(action, handler) {
  approvedHandlers.set(action, handler);
}
/** Register what happens when a request of `action` is rejected (e.g. document back to DRAFT). */
export function onRejected(action, handler) {
  rejectedHandlers.set(action, handler);
}

/**
 * BR-APR-01: pick the rule for a request. Pure: rules as loaded from APPROVAL_RULE.
 * Branch-specific rules win over "all branches" (0) at equal priority; lowest PRIORITY wins.
 */
export function matchRule(
  rules,
  { docType, brnch, amount = null, qty = null, conditionCode = null },
) {
  const candidates = rules.filter(
    (r) =>
      r.active &&
      r.docType === docType &&
      (r.brnch === 0 || r.brnch === brnch) &&
      (r.minAmount === null || (amount !== null && dec(amount).gte(r.minAmount))) &&
      (r.minQty === null || (qty !== null && dec(qty).gte(r.minQty))) &&
      (r.conditionCode === null || r.conditionCode === conditionCode),
  );
  candidates.sort((a, b) => a.priority - b.priority || b.brnch - a.brnch || a.ruleId - b.ruleId);
  return candidates[0] ?? null;
}

export const toRule = (r) => ({
  ruleId: r.RULE_ID,
  brnch: r.BRNCH,
  docType: r.DOC_TYPE,
  name: r.RULE_NAME,
  minAmount: r.MIN_AMOUNT ?? null,
  minQty: r.MIN_QTY ?? null,
  conditionCode: r.CONDITION_CODE ?? null,
  levels: r.LEVELS,
  levelRoles: [r.LEVEL1_ROLE, r.LEVEL2_ROLE, r.LEVEL3_ROLE].filter(Boolean),
  sameUserAllowed: r.SAME_USER_ALLOWED === 'Y',
  expireHours: r.EXPIRE_HOURS ?? null,
  priority: r.PRIORITY,
  active: r.ACTIVE === 'Y',
});

export const RULE_COLS = `RULE_ID, BRNCH, DOC_TYPE, RULE_NAME, MIN_AMOUNT, MIN_QTY, CONDITION_CODE, LEVELS,
  LEVEL1_ROLE, LEVEL2_ROLE, LEVEL3_ROLE, SAME_USER_ALLOWED, EXPIRE_HOURS, PRIORITY, ACTIVE`;

const REQ_SQL = `SELECT q.REQ_ID, q.BRNCH, q.RULE_ID, q.DOC_TYPE, q.DOC_KEY, q.ACTION, q.SNAPSHOT, q.AMOUNT, q.QTY,
    q.REASON, q.STATUS, q.CURRENT_LEVEL, q.REQUESTED_BY, q.REQUESTED_ON, q.DECIDED_ON, q.EXPIRES_ON, q.ROW_VER,
    r.LEVELS, r.LEVEL1_ROLE, r.LEVEL2_ROLE, r.LEVEL3_ROLE, r.SAME_USER_ALLOWED
  FROM APPROVAL_REQUEST q JOIN APPROVAL_RULE r ON r.RULE_ID = q.RULE_ID`;

/** @returns {ApprovalRequest} */
export function toRequest(r) {
  let snapshot = null;
  try {
    snapshot = r.SNAPSHOT ? JSON.parse(r.SNAPSHOT) : null;
  } catch {
    snapshot = r.SNAPSHOT;
  }
  return {
    reqId: r.REQ_ID,
    brnch: r.BRNCH,
    ruleId: r.RULE_ID,
    docType: r.DOC_TYPE,
    docKey: r.DOC_KEY,
    action: r.ACTION,
    snapshot,
    amount: r.AMOUNT ?? null,
    qty: r.QTY ?? null,
    reason: r.REASON,
    status: r.STATUS,
    currentLevel: r.CURRENT_LEVEL,
    levels: r.LEVELS,
    levelRoles: [r.LEVEL1_ROLE, r.LEVEL2_ROLE, r.LEVEL3_ROLE].filter(Boolean),
    requestedBy: r.REQUESTED_BY,
    requestedOn: r.REQUESTED_ON,
    decidedOn: r.DECIDED_ON ?? null,
    expiresOn: r.EXPIRES_ON ?? null,
    rowVer: r.ROW_VER,
    sameUserAllowed: r.SAME_USER_ALLOWED === 'Y',
  };
}

/** @param {Tx} tx */
export async function loadRequest(tx, reqId, { forUpdate = false } = {}) {
  const r = await tx.one(
    `${REQ_SQL} WHERE q.REQ_ID = :id${forUpdate ? ' FOR UPDATE OF q.STATUS' : ''}`,
    { id: reqId },
  );
  return r ? toRequest(r) : null;
}

/** In-app notification to every user holding `role` in `brnch` (BR-APR-03, BR-NTF-03). */
async function notifyRole(tx, role, brnch, { title, body, link }, now) {
  const users = await usersWithRole(tx, role, brnch);
  for (const u of users) {
    const id = await tx.nextId('SEQ_USER_NOTIFICATION');
    await tx.exec(
      `INSERT INTO USER_NOTIFICATION (NOTIF_ID, USER_ID, BRNCH, TITLE, BODY, LINK, SEVERITY, CREATED_ON)
       VALUES (:id, :u, :b, :t, :bd, :l, 'ACTION', :now)`,
      {
        id,
        u: u.userId,
        b: brnch,
        t: title.slice(0, 200),
        bd: body?.slice(0, 1000) ?? null,
        l: link,
        now,
      },
    );
  }
  return users.map((u) => u.userId);
}

async function notifyUser(tx, usrid, brnch, { title, body, link }, now) {
  const u = await tx.one('SELECT USER_ID FROM APP_USER WHERE USRID = :u', { u: usrid });
  if (!u) return [];
  const id = await tx.nextId('SEQ_USER_NOTIFICATION');
  await tx.exec(
    `INSERT INTO USER_NOTIFICATION (NOTIF_ID, USER_ID, BRNCH, TITLE, BODY, LINK, SEVERITY, CREATED_ON)
     VALUES (:id, :u, :b, :t, :bd, :l, 'INFO', :now)`,
    {
      id,
      u: u.USER_ID,
      b: brnch,
      t: title.slice(0, 200),
      bd: body?.slice(0, 1000) ?? null,
      l: link,
      now,
    },
  );
  return [u.USER_ID];
}

/**
 * BR-APR-02: create a request when a rule applies. Returns `{ required: false }` when no rule
 * matches (the caller then proceeds directly).
 * @param {Tx} tx
 * @param {{ userId: number, usrid: string, ip?: string, requestId?: string, now: Date }} ctx
 * @param {{ brnch: number, docType: string, docKey: string, action: string, snapshot: unknown,
 *   amount?: string|null, qty?: string|null, reason: string, conditionCode?: string|null }} input
 * @returns {Promise<{ required: false } | { required: true, requestId: number, notifiedUserIds: number[] }>}
 */
export async function requestApproval(tx, ctx, input) {
  const rules = (
    await tx.many(`SELECT ${RULE_COLS} FROM APPROVAL_RULE WHERE DOC_TYPE = :d AND ACTIVE = 'Y'`, {
      d: input.docType,
    })
  ).map(toRule);
  const rule = matchRule(rules, input);
  if (!rule) return { required: false };

  const open = await tx.one(
    `SELECT REQ_ID FROM APPROVAL_REQUEST WHERE DOC_TYPE = :d AND DOC_KEY = :k AND STATUS = 'PENDING'`,
    { d: input.docType, k: input.docKey },
  );
  if (open) {
    throw Errors.duplicate(
      `An approval request is already waiting for this document (#${open.REQ_ID})`,
      {
        data: { requestId: open.REQ_ID },
      },
    );
  }

  const reqId = await tx.nextId('SEQ_APPROVAL_REQUEST');
  const expiresOn = rule.expireHours
    ? new Date(ctx.now.getTime() + rule.expireHours * 3_600_000)
    : null;
  await tx.exec(
    `INSERT INTO APPROVAL_REQUEST (REQ_ID, BRNCH, RULE_ID, DOC_TYPE, DOC_KEY, ACTION, SNAPSHOT, AMOUNT, QTY, REASON,
        STATUS, CURRENT_LEVEL, REQUESTED_BY, REQUESTED_ON, EXPIRES_ON)
     VALUES (:id, :b, :rule, :d, :k, :act, :snap, :amt, :qty, :reason, 'PENDING', 1, :rb, :now, :exp)`,
    {
      id: reqId,
      b: input.brnch,
      rule: rule.ruleId,
      d: input.docType,
      k: input.docKey,
      act: input.action,
      snap: { type: oracledb.CLOB, val: JSON.stringify(input.snapshot ?? null) },
      amt: input.amount ?? null,
      qty: input.qty ?? null,
      reason: input.reason,
      rb: ctx.usrid,
      now: ctx.now,
      exp: expiresOn,
    },
  );
  await recordAudit(
    tx,
    { ...ctx, brnch: input.brnch },
    {
      entity: 'APPROVAL_REQUEST',
      key: reqId,
      action: 'CREATE',
      reason: input.reason,
      newValues: {
        docType: input.docType,
        docKey: input.docKey,
        action: input.action,
        ruleId: rule.ruleId,
      },
    },
  );
  const notifiedUserIds = await notifyRole(
    tx,
    rule.levelRoles[0],
    input.brnch,
    {
      title: `Approval needed: ${input.docType}`,
      body: `${input.docKey} — ${input.reason}`,
      link: `/approvals/${reqId}`,
    },
    ctx.now,
  );
  return { required: true, requestId: reqId, notifiedUserIds };
}

/**
 * Approve or reject the current level (BR-APR-01/02/05, PERMISSIONS P-3).
 * @param {Tx} tx
 * @param {{ userId: number, usrid: string, now: Date, rolesIn: (brnch: number) => Promise<string[]> }} ctx
 * @param {{ reqId: number, decision: 'APPROVED'|'REJECTED', comment?: string|null }} input
 */
export async function decide(tx, ctx, { reqId, decision, comment = null }) {
  const req = await loadRequest(tx, reqId, { forUpdate: true });
  if (!req) throw Errors.notFound('Approval request');
  if (req.status !== 'PENDING')
    throw Errors.invalidState(`This request is already ${req.status.toLowerCase()}`);
  if (req.expiresOn && new Date(req.expiresOn) <= ctx.now) {
    await tx.exec(
      `UPDATE APPROVAL_REQUEST SET STATUS = 'EXPIRED', DECIDED_ON = :now, ROW_VER = ROW_VER + 1 WHERE REQ_ID = :id`,
      {
        id: reqId,
        now: ctx.now,
      },
    );
    throw Errors.invalidState('This request has expired');
  }
  if (!req.sameUserAllowed) {
    if (req.requestedBy === ctx.usrid)
      throw Errors.makerChecker('You cannot approve your own request', 'BR-APR-01');
    const earlier = await tx.one(
      `SELECT COUNT(*) AS N FROM APPROVAL_ACTION WHERE REQ_ID = :id AND DECIDED_BY = :u`,
      { id: reqId, u: ctx.usrid },
    );
    if (earlier.N > 0)
      throw Errors.makerChecker(
        'You already decided an earlier level of this request',
        'BR-APR-01',
      );
  }
  const role = req.levelRoles[req.currentLevel - 1];
  if (!(await ctx.rolesIn(req.brnch)).includes(role)) {
    throw Errors.forbidden(`Level ${req.currentLevel} must be decided by role ${role}`);
  }

  const actionId = await tx.nextId('SEQ_APPROVAL_ACTION');
  await tx.exec(
    `INSERT INTO APPROVAL_ACTION (ACTION_ID, REQ_ID, LEVEL_NO, DECISION, DECIDED_BY, DECIDED_ON, COMMENTS)
     VALUES (:aid, :id, :lvl, :dec, :u, :now, :c)`,
    {
      aid: actionId,
      id: reqId,
      lvl: req.currentLevel,
      dec: decision,
      u: ctx.usrid,
      now: ctx.now,
      c: comment,
    },
  );

  let finalStatus = 'PENDING';
  let notified = [];
  if (decision === 'REJECTED') {
    finalStatus = 'REJECTED';
  } else if (req.currentLevel < req.levels) {
    await tx.exec(
      `UPDATE APPROVAL_REQUEST SET CURRENT_LEVEL = CURRENT_LEVEL + 1, ROW_VER = ROW_VER + 1 WHERE REQ_ID = :id`,
      { id: reqId },
    );
    notified = await notifyRole(
      tx,
      req.levelRoles[req.currentLevel],
      req.brnch,
      {
        title: `Approval needed: ${req.docType} (level ${req.currentLevel + 1})`,
        body: `${req.docKey} — ${req.reason}`,
        link: `/approvals/${reqId}`,
      },
      ctx.now,
    );
  } else {
    finalStatus = 'APPROVED';
  }

  if (finalStatus !== 'PENDING') {
    await tx.exec(
      `UPDATE APPROVAL_REQUEST SET STATUS = :s, DECIDED_ON = :now, ROW_VER = ROW_VER + 1 WHERE REQ_ID = :id`,
      { id: reqId, s: finalStatus, now: ctx.now },
    );
    const handler = (finalStatus === 'APPROVED' ? approvedHandlers : rejectedHandlers).get(
      req.action,
    );
    if (handler) await handler(tx, { ...req, status: finalStatus }, ctx);
    notified = await notifyUser(
      tx,
      req.requestedBy,
      req.brnch,
      {
        title: `${req.docType} ${finalStatus.toLowerCase()}`,
        body: `${req.docKey}${comment ? ` — ${comment}` : ''}`,
        link: `/approvals/${reqId}`,
      },
      ctx.now,
    );
  }

  await recordAudit(
    tx,
    { ...ctx, brnch: req.brnch },
    {
      entity: 'APPROVAL_REQUEST',
      key: reqId,
      action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
      reason: comment,
      newValues: { level: req.currentLevel, status: finalStatus },
    },
  );
  return {
    reqId,
    status: finalStatus,
    currentLevel: finalStatus === 'PENDING' ? req.currentLevel + 1 : req.currentLevel,
    notifiedUserIds: notified,
  };
}

/** Requester withdraws a pending request. @param {Tx} tx */
export async function cancelRequest(tx, ctx, reqId) {
  const req = await loadRequest(tx, reqId, { forUpdate: true });
  if (!req) throw Errors.notFound('Approval request');
  if (req.requestedBy !== ctx.usrid)
    throw Errors.forbidden('Only the requester can cancel this request');
  if (req.status !== 'PENDING')
    throw Errors.invalidState(`This request is already ${req.status.toLowerCase()}`);
  await tx.exec(
    `UPDATE APPROVAL_REQUEST SET STATUS = 'CANCELLED', DECIDED_ON = :now, ROW_VER = ROW_VER + 1 WHERE REQ_ID = :id`,
    {
      id: reqId,
      now: ctx.now,
    },
  );
  const handler = rejectedHandlers.get(req.action);
  if (handler) await handler(tx, { ...req, status: 'CANCELLED' }, ctx);
  await recordAudit(
    tx,
    { ...ctx, brnch: req.brnch },
    { entity: 'APPROVAL_REQUEST', key: reqId, action: 'CANCEL' },
  );
}

/** Mark overdue requests EXPIRED (worker job). @param {Tx} tx */
export async function expireOverdue(tx, now) {
  return tx.exec(
    `UPDATE APPROVAL_REQUEST SET STATUS = 'EXPIRED', DECIDED_ON = :now, ROW_VER = ROW_VER + 1
      WHERE STATUS = 'PENDING' AND EXPIRES_ON IS NOT NULL AND EXPIRES_ON <= :now`,
    { now },
  );
}

/**
 * Requests waiting for one of the user's roles at their current level (inbox).
 * @param {Tx} tx
 * @param {{ brnch: number, roles: string[] }[]} rolesByBranch
 */
export async function inbox(tx, rolesByBranch, { status = 'PENDING' } = {}) {
  const out = [];
  for (const { brnch, roles } of rolesByBranch) {
    if (!roles.length) continue;
    const rows = await tx.many(
      `${REQ_SQL} WHERE q.BRNCH = :b AND q.STATUS = :s ORDER BY q.REQUESTED_ON`,
      { b: brnch, s: status },
    );
    for (const r of rows.map(toRequest)) {
      if (roles.includes(r.levelRoles[r.currentLevel - 1])) out.push(r);
    }
  }
  return out.sort((a, b) => new Date(a.requestedOn) - new Date(b.requestedOn));
}

/** @param {Tx} tx */
export async function sentBy(tx, usrid) {
  const rows = await tx.many(`${REQ_SQL} WHERE q.REQUESTED_BY = :u ORDER BY q.REQUESTED_ON DESC`, {
    u: usrid,
  });
  return rows.map(toRequest);
}

/** @param {Tx} tx */
export async function history(tx, reqId) {
  const rows = await tx.many(
    `SELECT LEVEL_NO, DECISION, DECIDED_BY, DECIDED_ON, COMMENTS FROM APPROVAL_ACTION WHERE REQ_ID = :id ORDER BY ACTION_ID`,
    { id: reqId },
  );
  return rows.map((r) => ({
    level: r.LEVEL_NO,
    decision: r.DECISION,
    decidedBy: r.DECIDED_BY,
    decidedOn: r.DECIDED_ON,
    comments: r.COMMENTS,
  }));
}
