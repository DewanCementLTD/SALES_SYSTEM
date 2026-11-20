// Geography rules (TASKS P1-02, SCHEMA §2.3). Nodes are never deleted: deactivating a node also
// deactivates everything below it; a node can be activated only under an active parent.
// Codes are fixed once created (customer codes are built from them, BR-CUS-03).
import { GEO_LEVELS, childGeoCode } from '@dcl/shared';
import { Errors } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import * as repo from './repo.js';

/** @typedef {{ usrid: string, audit: object, now: Date }} Actor */

const parentOf = (geoCode) => {
  const parts = geoCode.split('-');
  return parts.length > 1 ? parts.slice(0, -1).join('-') : null;
};

async function loadForUpdate(tx, brnch, geoCode, rowVer) {
  const node = await repo.getNode(tx, brnch, geoCode, { forUpdate: true });
  if (!node) throw Errors.notFound('Geography node');
  if (rowVer !== undefined && node.rowVer !== rowVer) throw Errors.versionConflict();
  return node;
}

/**
 * @param {import('../../lib/oracle/db.js').Tx} tx
 * @param {Actor} actor
 * @param {number} brnch
 * @param {{ parentCode: string|null, code: string, name: string }} body
 */
export async function createNode(tx, actor, brnch, body) {
  const geoCode = childGeoCode(body.parentCode, body.code);
  const level = geoCode.split('-').length;
  /** @type {Record<string, any>} */
  const row = {
    brnch,
    geoCode,
    level,
    zoneCode: null,
    zoneName: null,
    territoryCode: null,
    territoryName: null,
    areaCode: null,
    areaName: null,
    cityCode: null,
    cityName: null,
  };
  if (body.parentCode) {
    const parent = await repo.getRaw(tx, brnch, body.parentCode);
    if (!parent) throw Errors.notFound(`Parent ${body.parentCode}`);
    if (parent.ACTIVE !== 'Y') {
      throw Errors.invalidState(`Parent ${body.parentCode} is inactive. Activate it first.`);
    }
    for (const lv of [1, 2, 3]) {
      const c = repo.LEVEL_COLS[lv];
      row[`${GEO_LEVELS[lv - 1].field}Code`] = parent[c.code];
      row[`${GEO_LEVELS[lv - 1].field}Name`] = parent[c.name];
    }
  }
  const own = GEO_LEVELS[level - 1].field;
  row[`${own}Code`] = body.code;
  row[`${own}Name`] = body.name;
  if (await repo.getRaw(tx, brnch, geoCode)) {
    throw Errors.duplicate(
      `${GEO_LEVELS[level - 1].name} ${geoCode} already exists in branch ${brnch}`,
    );
  }
  await repo.insertNode(tx, row, actor);
  await recordAudit(tx, actor.audit, {
    entity: 'GEO_HIERARCHY',
    key: `${brnch}|${geoCode}`,
    action: 'CREATE',
    brnch,
    newValues: { geoCode, name: body.name },
  });
  return repo.getNode(tx, brnch, geoCode);
}

export async function renameNode(tx, actor, brnch, geoCode, rowVer, name) {
  const node = await loadForUpdate(tx, brnch, geoCode, rowVer);
  if (node.name === name) return node;
  if (!(await repo.renameNode(tx, brnch, geoCode, node.level, rowVer, name, actor))) {
    throw Errors.versionConflict();
  }
  await recordAudit(tx, actor.audit, {
    entity: 'GEO_HIERARCHY',
    key: `${brnch}|${geoCode}`,
    action: 'UPDATE',
    brnch,
    oldValues: { name: node.name },
    newValues: { name },
  });
  return repo.getNode(tx, brnch, geoCode);
}

export async function setActive(tx, actor, brnch, geoCode, rowVer, active, reason) {
  const node = await loadForUpdate(tx, brnch, geoCode, rowVer);
  if (node.active === active) {
    throw Errors.invalidState(`${node.geoCode} is already ${active ? 'active' : 'inactive'}`);
  }
  if (active) {
    const parentCode = parentOf(geoCode);
    const parent = parentCode ? await repo.getRaw(tx, brnch, parentCode) : null;
    if (parent && parent.ACTIVE !== 'Y') {
      throw Errors.invalidState(`Parent ${parentCode} is inactive. Activate it first.`);
    }
  }
  const res = await repo.setActive(tx, brnch, geoCode, rowVer, active, !active, actor);
  if (!res.changed) throw Errors.versionConflict();
  await recordAudit(tx, actor.audit, {
    entity: 'GEO_HIERARCHY',
    key: `${brnch}|${geoCode}`,
    action: active ? 'ACTIVATE' : 'DEACTIVATE',
    brnch,
    reason: reason ?? null,
    oldValues: { active: node.active },
    newValues: { active, descendantsDeactivated: res.descendants },
  });
  return { ...(await repo.getNode(tx, brnch, geoCode)), descendantsChanged: res.descendants };
}
