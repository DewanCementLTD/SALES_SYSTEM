// Simple master rules (TASKS P1-01, PRD 4.3): create / update / deactivate / activate, never delete
// (BUSINESS_RULES §1). Each command is one transaction with its audit row (CLAUDE.md rule 6).
import { DERIVED_LOOKUPS, MASTERS, masterKeyOf } from '@dcl/shared';
import { Errors } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import * as repo from './repo.js';

/**
 * @typedef {import('../../lib/oracle/db.js').Tx} Tx
 * @typedef {import('@dcl/shared').MasterDef} MasterDef
 * @typedef {{ usrid: string, audit: object, now: Date, lookupCache?: ReturnType<typeof createLookupCache> }} Actor
 */

/** @returns {MasterDef} */
export function masterDef(type) {
  const def = MASTERS[type];
  if (!def) throw Errors.notFound(`Master type ${type}`);
  return def;
}

function writable(def) {
  if (def.readOnly) {
    throw Errors.invalidState(`${def.title} cannot be edited here. ${def.note ?? ''}`.trim());
  }
}

const auditKey = (def, brnch, row) => `${brnch}|${masterKeyOf(def, row)}`;

/** Referenced values must exist in the same branch (no cross-branch links, BR-BR-04). */
async function checkRefs(tx, def, brnch, values) {
  for (const f of def.fields) {
    if (f.kind !== 'ref') continue;
    const v = values[f.name];
    if (v === null || v === undefined) continue;
    const ok =
      f.ref === 'product-codes'
        ? await repo.productCodeExists(tx, brnch, v)
        : await repo.refExists(tx, MASTERS[f.ref], brnch, v);
    if (!ok) {
      throw Errors.validation(`${f.label} ${v} does not exist in branch ${brnch}`, [
        { path: `body.${f.name}`, message: `Unknown ${f.label.toLowerCase()}` },
      ]);
    }
  }
}

/** Fill auto-numbered key/fields left empty (max + 1 per branch). */
async function fillAuto(tx, def, brnch, values) {
  const out = { ...values };
  for (const f of [...def.key, ...def.fields]) {
    if (f.auto && (out[f.name] === null || out[f.name] === undefined)) {
      out[f.name] = await repo.nextNumber(tx, def, f.col, brnch);
    }
  }
  return out;
}

/**
 * @param {Tx} tx
 * @param {Actor} actor
 * @param {MasterDef} def
 * @param {number} brnch
 * @param {Record<string, any>} body validated create body
 */
export async function createMaster(tx, actor, def, brnch, body) {
  writable(def);
  const values = await fillAuto(tx, def, brnch, body);
  const key = Object.fromEntries(def.key.map((k) => [k.name, values[k.name]]));
  if (await repo.get(tx, def, brnch, key)) {
    throw Errors.duplicate(
      `${def.singular} ${masterKeyOf(def, key)} already exists in branch ${brnch}`,
    );
  }
  await checkRefs(tx, def, brnch, values);
  await repo.insert(tx, def, brnch, values, actor);
  const row = await repo.get(tx, def, brnch, key);
  await recordAudit(tx, actor.audit, {
    entity: def.table,
    key: auditKey(def, brnch, row),
    action: 'CREATE',
    brnch,
    newValues: values,
  });
  actor.lookupCache?.invalidate(brnch, def.type);
  return row;
}

/** Fields that changed (for the audit diff). */
function diff(def, before, values) {
  const oldValues = {};
  const newValues = {};
  for (const f of def.fields) {
    if (!(f.name in values)) continue;
    const a = before[f.name] ?? null;
    const b = values[f.name] ?? null;
    if (String(a) !== String(b)) {
      oldValues[f.name] = a;
      newValues[f.name] = b;
    }
  }
  return { oldValues, newValues };
}

async function loadForUpdate(tx, def, brnch, key) {
  const row = await repo.get(tx, def, brnch, key, { forUpdate: true });
  if (!row) throw Errors.notFound(def.singular);
  return row;
}

export async function updateMaster(tx, actor, def, brnch, key, rowVer, body) {
  writable(def);
  const before = await loadForUpdate(tx, def, brnch, key);
  if (before.rowVer !== rowVer) throw Errors.versionConflict();
  await checkRefs(tx, def, brnch, body);
  if (!(await repo.update(tx, def, brnch, key, rowVer, body, actor)))
    throw Errors.versionConflict();
  const { oldValues, newValues } = diff(def, before, body);
  await recordAudit(tx, actor.audit, {
    entity: def.table,
    key: auditKey(def, brnch, before),
    action: 'UPDATE',
    brnch,
    oldValues,
    newValues,
  });
  actor.lookupCache?.invalidate(brnch, def.type);
  return repo.get(tx, def, brnch, key);
}

export async function setMasterActive(tx, actor, def, brnch, key, rowVer, active, reason) {
  writable(def);
  const before = await loadForUpdate(tx, def, brnch, key);
  if (before.rowVer !== rowVer) throw Errors.versionConflict();
  if (before.active === active) {
    throw Errors.invalidState(`${def.singular} is already ${active ? 'active' : 'inactive'}`);
  }
  await repo.setActive(tx, def, brnch, key, rowVer, active, actor);
  await recordAudit(tx, actor.audit, {
    entity: def.table,
    key: auditKey(def, brnch, before),
    action: active ? 'ACTIVATE' : 'DEACTIVATE',
    brnch,
    reason: reason ?? null,
    oldValues: { active: before.active },
    newValues: { active },
  });
  actor.lookupCache?.invalidate(brnch, def.type);
  return repo.get(tx, def, brnch, key);
}

// --- lookups (API_SPEC §4: cached 5 min, branch-scoped) ---------------------------------------

export const LOOKUP_TYPES = Object.freeze([
  ...Object.values(MASTERS)
    .filter((d) => d.key.length === 1)
    .map((d) => d.type),
  ...DERIVED_LOOKUPS,
]);

const LOOKUP_TTL_MS = 5 * 60 * 1000;

/**
 * Per-app lookup cache. A write drops the branch/type entry in this process; other API processes
 * see the change within the 5-minute TTL.
 */
export function createLookupCache() {
  /** @type {Map<string, { at: number, items: any[] }>} */
  const map = new Map();
  const k = (brnch, type) => `${brnch}|${type}`;
  return {
    get: (brnch, type, nowMs) => {
      const hit = map.get(k(brnch, type));
      return hit && nowMs - hit.at < LOOKUP_TTL_MS ? hit.items : null;
    },
    set: (brnch, type, nowMs, items) => map.set(k(brnch, type), { at: nowMs, items }),
    invalidate: (brnch, type) => map.delete(k(brnch, type)),
  };
}

/**
 * @param {Tx} tx
 * @param {number} brnch
 * @param {string[]} types validated against LOOKUP_TYPES
 * @param {number} nowMs
 * @param {ReturnType<typeof createLookupCache>} cache
 */
export async function lookups(tx, brnch, types, nowMs, cache) {
  /** @type {Record<string, any[]>} */
  const out = {};
  for (const type of types) {
    let items = cache.get(brnch, type, nowMs);
    if (!items) {
      if (type === 'product-codes') items = await repo.productCodes(tx, brnch);
      else if (type === 'customer-zones') items = await repo.customerZones(tx, brnch);
      else items = await repo.lookup(tx, MASTERS[type], brnch);
      cache.set(brnch, type, nowMs, items);
    }
    out[type] = items;
  }
  return out;
}
