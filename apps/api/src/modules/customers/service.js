// Customer rules (BR-CUS-01..08, PRD 4.2, TASKS P1-03). One transaction per command (CLAUDE.md 6).
// Approval goes through the approval engine (CUSTOMER_APPROVE): actions CUSTOMER_CREATE (new
// customer) and CUSTOMER_CHANGE (tax profile / contact numbers of an approved customer).
import {
  CUSTOMER_FIELDS,
  MASTERS,
  approvalFieldsIn,
  customerCode,
  customerCodePrefix,
  nextCustomerSeq,
  parseGeoCode,
} from '@dcl/shared';
import { Errors } from '../../lib/errors.js';
import { decide, onApproved, onRejected, requestApproval } from '../approvals/service.js';
import { recordAudit } from '../audit/service.js';
import { customerZoneExists, refExists } from '../masters/repo.js';
import * as repo from './repo.js';

/** @typedef {import('../../lib/oracle/db.js').Tx} Tx */
/** @typedef {{ userId: number, usrid: string, audit: object, now: Date }} Actor */

const docKey = (brnch, code) => `${brnch}|${code}`;
const FIELD = Object.fromEntries(CUSTOMER_FIELDS.map((f) => [f.name, f]));

async function load(tx, brnch, code, { forUpdate = false, rowVer } = {}) {
  const c = await repo.getCustomer(tx, brnch, code, { forUpdate });
  if (!c) throw Errors.notFound('Customer');
  if (rowVer !== undefined && c.rowVer !== rowVer) throw Errors.versionConflict();
  return c;
}

/** Channel/category must exist in the customer's branch. */
async function checkRefs(tx, brnch, values) {
  for (const f of CUSTOMER_FIELDS.filter((x) => x.kind === 'ref')) {
    const v = values[f.name];
    if (v === null || v === undefined) continue;
    if (!(await refExists(tx, MASTERS[f.ref], brnch, v))) {
      throw Errors.validation(`${f.label} ${v} does not exist in branch ${brnch}`, [
        { path: `body.${f.name}`, message: `Unknown ${f.label.toLowerCase()}` },
      ]);
    }
  }
}

/**
 * Geography node a new customer is placed in: active, area level or deeper (BR-CUS-03 needs
 * zone, territory and area codes).
 */
async function placement(tx, brnch, geoCode, { lock = false } = {}) {
  const parsed = parseGeoCode(geoCode);
  if (!parsed || parsed.level < 3) {
    throw Errors.validation('Choose an area or a city for the customer', [
      { path: 'body.geoCode', message: 'Area or city required' },
    ]);
  }
  const node = await tx.one(
    `SELECT GEO_CODE, ACTIVE FROM GEO_HIERARCHY WHERE BRNCH = :b AND GEO_CODE = :g`,
    { b: brnch, g: geoCode },
  );
  if (!node) throw Errors.validation(`Geography ${geoCode} does not exist in branch ${brnch}`);
  if (node.ACTIVE !== 'Y') throw Errors.invalidState(`Geography ${geoCode} is inactive`);
  if (lock) {
    // serialise code generation per area (two users adding customers in one area at once)
    const areaCode = geoCode.split('-').slice(0, 3).join('-');
    await tx.one('SELECT GEO_ID FROM GEO_HIERARCHY WHERE BRNCH = :b AND GEO_CODE = :g FOR UPDATE', {
      b: brnch,
      g: areaCode,
    });
  }
  let prefix;
  try {
    prefix = customerCodePrefix(parsed);
  } catch (e) {
    throw Errors.rule('BR-CUS-03', /** @type {Error} */ (e).message);
  }
  return { parsed, prefix };
}

/** BR-CUS-03 code the next customer in this geography would get (no number is reserved). */
export async function previewCode(tx, brnch, geoCode) {
  const { prefix } = await placement(tx, brnch, geoCode);
  const seq = nextCustomerSeq(prefix, await repo.codesWithPrefix(tx, brnch, prefix));
  try {
    return { code: customerCode(prefix, seq) };
  } catch (e) {
    throw Errors.rule('BR-CUS-03', /** @type {Error} */ (e).message);
  }
}

async function askApproval(tx, actor, brnch, code, action, snapshot, reason) {
  return requestApproval(
    tx,
    { ...actor.audit, now: actor.now },
    {
      docType: 'CUSTOMER_APPROVE',
      brnch,
      docKey: docKey(brnch, code),
      action,
      snapshot,
      reason,
    },
  );
}

/**
 * Create a customer: code from geography (BR-CUS-03), status PENDING_APPROVAL, approval request.
 * @param {Tx} tx @param {Actor} actor @param {number} brnch
 * @param {Record<string, any> & { geoCode: string, zoneCode: string|null }} body
 */
export async function createCustomer(tx, actor, brnch, body) {
  const { geoCode, zoneCode, ...values } = body;
  const { parsed, prefix } = await placement(tx, brnch, geoCode, { lock: true });
  await checkRefs(tx, brnch, values);
  const zone = zoneCode ?? parsed.zone;
  if (!(await customerZoneExists(tx, brnch, zone))) {
    throw Errors.validation(
      zoneCode
        ? `Customer zone ${zoneCode} does not exist in branch ${brnch}`
        : 'Choose the customer zone',
      [{ path: 'body.zoneCode', message: 'Customer zone required' }],
    );
  }
  const seq = nextCustomerSeq(prefix, await repo.codesWithPrefix(tx, brnch, prefix));
  let code;
  try {
    code = customerCode(prefix, seq);
  } catch (e) {
    throw Errors.rule('BR-CUS-03', /** @type {Error} */ (e).message);
  }
  await repo.insertCustomer(
    tx,
    {
      brnch,
      code,
      zone,
      territory: parsed.territory.padStart(2, '0'),
      area: parsed.area.padStart(2, '0'),
      geoCode,
      values,
    },
    actor,
  );
  await recordAudit(tx, actor.audit, {
    entity: 'CUSTOMER_INFO',
    key: docKey(brnch, code),
    action: 'CREATE',
    brnch,
    newValues: { ...values, geoCode, zoneCode: zone },
  });
  const approval = await askApproval(
    tx,
    actor,
    brnch,
    code,
    'CUSTOMER_CREATE',
    {
      customerCode: code,
      customerName: values.customerName,
      channelCode: values.channelCode,
      geoCode,
    },
    `New customer ${code} ${values.customerName}`,
  );
  return {
    customer: await repo.getCustomer(tx, brnch, code),
    requestId: approval.required ? approval.requestId : null,
  };
}

/**
 * Edit a customer. Draft/pending: applied directly. Approved/blocked: tax-profile and contact-number
 * changes go to a change request (BR-CUS-02); other fields apply at once.
 */
export async function updateCustomer(tx, actor, brnch, code, rowVer, patch) {
  const before = await load(tx, brnch, code, { forUpdate: true, rowVer });
  if (before.status === 'CLOSED') throw Errors.invalidState('A closed customer cannot be edited');
  await checkRefs(tx, brnch, patch);

  const changed = Object.fromEntries(
    Object.entries(patch).filter(([k, v]) => String(before[k] ?? '') !== String(v ?? '')),
  );
  const needApproval =
    before.status === 'APPROVED' || before.status === 'BLOCKED' ? approvalFieldsIn(changed) : [];
  let requestId = null;
  const direct = { ...changed };
  if (needApproval.length) {
    const changes = needApproval.map((name) => ({
      field: name,
      label: FIELD[name].label,
      from: before[name] ?? null,
      to: changed[name] ?? null,
    }));
    const r = await askApproval(
      tx,
      actor,
      brnch,
      code,
      'CUSTOMER_CHANGE',
      { customerCode: code, customerName: before.customerName, changes },
      `Change ${changes.map((c) => c.label).join(', ')} of ${code}`,
    );
    if (r.required) {
      requestId = r.requestId;
      for (const n of needApproval) delete direct[n];
    }
  }
  if (Object.keys(direct).length) {
    if (!(await repo.updateFields(tx, brnch, code, rowVer, direct, actor)))
      throw Errors.versionConflict();
    await recordAudit(tx, actor.audit, {
      entity: 'CUSTOMER_INFO',
      key: docKey(brnch, code),
      action: 'UPDATE',
      brnch,
      oldValues: Object.fromEntries(Object.keys(direct).map((k) => [k, before[k] ?? null])),
      newValues: direct,
    });
  }
  return {
    customer: await repo.getCustomer(tx, brnch, code),
    requestId,
    pendingFields: requestId ? needApproval : [],
  };
}

/**
 * Approve or reject a pending new customer or change (customer.approve; maker-checker BR-CUS-02).
 * With a pending approval request the engine decides; without one (rule switched off) the customer
 * is approved directly, still never by its maker.
 */
export async function decideCustomer(tx, ctx, brnch, code, decision, comment) {
  const c = await load(tx, brnch, code, { forUpdate: true });
  const pending = await repo.pendingRequest(tx, brnch, code);
  if (pending) {
    const res = await decide(tx, ctx, { reqId: pending.requestId, decision, comment });
    return { customer: await repo.getCustomer(tx, brnch, code), request: res };
  }
  if (c.status !== 'PENDING_APPROVAL') {
    throw Errors.invalidState(`Customer ${code} has nothing waiting for approval (${c.status})`);
  }
  if (c.createdBy === ctx.usrid) throw Errors.makerChecker(undefined, 'BR-CUS-02');
  const status = decision === 'APPROVED' ? 'APPROVED' : 'DRAFT';
  await repo.setStatus(tx, brnch, code, status, { ...ctx, approved: status === 'APPROVED' });
  await recordAudit(tx, ctx, {
    entity: 'CUSTOMER_INFO',
    key: docKey(brnch, code),
    action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
    brnch,
    reason: comment ?? null,
    newValues: { status },
  });
  return { customer: await repo.getCustomer(tx, brnch, code), request: null };
}

/** A rejected (DRAFT) customer is sent for approval again. */
export async function submitCustomer(tx, actor, brnch, code, rowVer) {
  const c = await load(tx, brnch, code, { forUpdate: true, rowVer });
  if (c.status !== 'DRAFT')
    throw Errors.invalidState(`Only a draft can be submitted (${c.status})`);
  await repo.setStatus(tx, brnch, code, 'PENDING_APPROVAL', actor);
  const r = await askApproval(
    tx,
    actor,
    brnch,
    code,
    'CUSTOMER_CREATE',
    {
      customerCode: code,
      customerName: c.customerName,
      channelCode: c.channelCode,
      geoCode: c.geoCode,
    },
    `New customer ${code} ${c.customerName}`,
  );
  await recordAudit(tx, actor.audit, {
    entity: 'CUSTOMER_INFO',
    key: docKey(brnch, code),
    action: 'SUBMIT',
    brnch,
  });
  return {
    customer: await repo.getCustomer(tx, brnch, code),
    requestId: r.required ? r.requestId : null,
  };
}

/** BR-CUS-08: block / unblock with reason; history in CUSTOMER_BLOCK. */
export async function setBlocked(tx, actor, brnch, code, rowVer, block, { reason, stopDispatch }) {
  const c = await load(tx, brnch, code, { forUpdate: true, rowVer });
  if (block && c.status !== 'APPROVED') {
    throw Errors.invalidState(`Only an approved customer can be blocked (${c.status})`);
  }
  if (!block && c.status !== 'BLOCKED') throw Errors.invalidState('Customer is not blocked');
  await repo.setStatus(tx, brnch, code, block ? 'BLOCKED' : 'APPROVED', actor);
  await repo.insertBlock(
    tx,
    {
      brnch,
      code,
      action: block ? 'BLOCK' : 'UNBLOCK',
      stopDispatch: block && stopDispatch,
      reason,
    },
    actor,
  );
  await recordAudit(tx, actor.audit, {
    entity: 'CUSTOMER_INFO',
    key: docKey(brnch, code),
    action: block ? 'BLOCK' : 'UNBLOCK',
    brnch,
    reason,
    newValues: { stopDispatch: block && !!stopDispatch },
  });
  return repo.getCustomer(tx, brnch, code);
}

// --- approval engine hooks (run inside the deciding transaction) --------------------------------

const keyOf = (req) => {
  const [b, ...rest] = req.docKey.split('|');
  return { brnch: Number(b), code: rest.join('|') };
};

onApproved('CUSTOMER_CREATE', async (tx, req, ctx) => {
  const { brnch, code } = keyOf(req);
  await repo.setStatus(tx, brnch, code, 'APPROVED', {
    usrid: ctx.usrid,
    now: ctx.now,
    approved: true,
  });
});
onRejected('CUSTOMER_CREATE', async (tx, req, ctx) => {
  const { brnch, code } = keyOf(req);
  await repo.setStatus(tx, brnch, code, 'DRAFT', { usrid: ctx.usrid, now: ctx.now });
});
onApproved('CUSTOMER_CHANGE', async (tx, req, ctx) => {
  const { brnch, code } = keyOf(req);
  const c = await load(tx, brnch, code, { forUpdate: true });
  const values = {};
  for (const ch of req.snapshot.changes) {
    if (String(c[ch.field] ?? '') !== String(ch.from ?? '')) {
      throw Errors.invalidState(
        `${ch.label} of ${code} was changed after this request was made. Reject it and ask again.`,
      );
    }
    values[ch.field] = ch.to;
  }
  await repo.updateFields(tx, brnch, code, c.rowVer, values, { usrid: ctx.usrid, now: ctx.now });
  await recordAudit(tx, ctx, {
    entity: 'CUSTOMER_INFO',
    key: docKey(brnch, code),
    action: 'UPDATE',
    brnch,
    reason: `Approved change request #${req.reqId}`,
    oldValues: Object.fromEntries(req.snapshot.changes.map((x) => [x.field, x.from])),
    newValues: values,
  });
});
