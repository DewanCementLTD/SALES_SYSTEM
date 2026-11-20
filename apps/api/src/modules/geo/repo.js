// SQL for GEO_HIERARCHY and its LEGACY_MAP (TASKS P1-02, SCHEMA §2.3). Level columns come from a
// fixed allow-list; values are bound.
import { branchFilter } from '../../lib/branch-scope.js';
import { paginate } from '../../lib/oracle/paginate.js';

export const LEVEL_COLS = [
  null,
  { code: 'ZONE_CODE', name: 'ZONE_NAME' },
  { code: 'TERRITORY_CODE', name: 'TERRITORY_NAME' },
  { code: 'AREA_CODE', name: 'AREA_NAME' },
  { code: 'CITY_CODE', name: 'CITY_NAME' },
];

const NODE_COLS = `g.GEO_ID, g.BRNCH, g.GEO_CODE, g.GEO_LEVEL, g.ZONE_CODE, g.ZONE_NAME, g.TERRITORY_CODE,
  g.TERRITORY_NAME, g.AREA_CODE, g.AREA_NAME, g.CITY_CODE, g.CITY_NAME, g.SOURCE_TABLE, g.LEGACY_CODE,
  g.ACTIVE, g.ROW_VER, g.UPDATED_BY, g.UPDATED_ON,
  (SELECT COUNT(*) FROM GEO_HIERARCHY c WHERE c.BRNCH = g.BRNCH AND c.GEO_LEVEL = g.GEO_LEVEL + 1
     AND c.GEO_CODE LIKE g.GEO_CODE || '-%') AS CHILD_COUNT,
  (SELECT COUNT(*) FROM CUSTOMER_INFO ci WHERE ci.BRNCH = g.BRNCH
     AND (ci.GEO_CODE = g.GEO_CODE OR ci.GEO_CODE LIKE g.GEO_CODE || '-%')) AS CUSTOMER_COUNT`;

export function mapNode(r) {
  if (!r) return null;
  const level = Number(r.GEO_LEVEL);
  const path = [r.ZONE_NAME, r.TERRITORY_NAME, r.AREA_NAME, r.CITY_NAME].slice(0, level);
  return {
    geoId: Number(r.GEO_ID),
    brnch: Number(r.BRNCH),
    geoCode: r.GEO_CODE,
    level,
    code: r[LEVEL_COLS[level].code],
    name: r[LEVEL_COLS[level].name],
    path,
    sourceTable: r.SOURCE_TABLE,
    legacyCode: r.LEGACY_CODE === '-' ? null : r.LEGACY_CODE,
    active: r.ACTIVE === 'Y',
    rowVer: Number(r.ROW_VER),
    updatedBy: r.UPDATED_BY ?? null,
    updatedOn: r.UPDATED_ON ?? null,
    childCount: Number(r.CHILD_COUNT),
    customerCount: Number(r.CUSTOMER_COUNT),
  };
}

/**
 * @param {import('../../lib/oracle/db.js').Tx} tx
 * @param {{ branches: number[], parentCode?: string|null, level?: number, q?: string, active?: boolean, page?: number, pageSize?: number }} o
 */
export async function listNodes(tx, o) {
  const bf = branchFilter('g.BRNCH', o.branches);
  const where = [bf.sql];
  const binds = { ...bf.binds };
  if (o.parentCode) {
    where.push(`g.GEO_CODE LIKE :pfx ESCAPE '\\'`, 'g.GEO_LEVEL = :plevel');
    binds.pfx = `${o.parentCode.replace(/[\\%_]/g, (m) => `\\${m}`)}-%`;
    binds.plevel = o.parentCode.split('-').length + 1;
  } else if (o.level) {
    where.push('g.GEO_LEVEL = :lvl');
    binds.lvl = o.level;
  }
  if (o.q) {
    where.push(
      `(UPPER(g.ZONE_NAME || ' ' || g.TERRITORY_NAME || ' ' || g.AREA_NAME || ' ' || g.CITY_NAME) LIKE :q ESCAPE '\\'
        OR g.GEO_CODE LIKE :q ESCAPE '\\' OR g.LEGACY_CODE = :qraw)`,
    );
    binds.q = `%${o.q.toUpperCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    binds.qraw = o.q;
  }
  if (o.active !== undefined) {
    where.push('g.ACTIVE = :act');
    binds.act = o.active ? 'Y' : 'N';
  }
  const page = await paginate(tx, {
    sql: `SELECT ${NODE_COLS} FROM GEO_HIERARCHY g WHERE ${where.join(' AND ')}
          ORDER BY g.BRNCH, g.GEO_LEVEL, g.ZONE_NAME, g.TERRITORY_NAME, g.AREA_NAME, g.CITY_NAME, g.GEO_ID`,
    binds,
    page: o.page,
    pageSize: o.pageSize,
  });
  return { ...page, items: page.items.map(mapNode) };
}

export async function getNode(tx, brnch, geoCode, { forUpdate = false } = {}) {
  if (forUpdate) {
    await tx.one(
      'SELECT GEO_ID FROM GEO_HIERARCHY WHERE BRNCH = :brnch AND GEO_CODE = :code FOR UPDATE',
      { brnch, code: geoCode },
    );
  }
  const r = await tx.one(
    `SELECT ${NODE_COLS} FROM GEO_HIERARCHY g WHERE g.BRNCH = :brnch AND g.GEO_CODE = :code`,
    { brnch, code: geoCode },
  );
  return mapNode(r);
}

/** Raw row (for copying ancestor codes/names into a child). */
export function getRaw(tx, brnch, geoCode) {
  return tx.one('SELECT * FROM GEO_HIERARCHY WHERE BRNCH = :brnch AND GEO_CODE = :code', {
    brnch,
    code: geoCode,
  });
}

export async function insertNode(tx, row, { usrid, now }) {
  const id = await tx.nextId('SEQ_GEO_HIERARCHY');
  await tx.exec(
    `INSERT INTO GEO_HIERARCHY (GEO_ID, GEO_CODE, GEO_LEVEL, ZONE_CODE, ZONE_NAME, TERRITORY_CODE,
       TERRITORY_NAME, AREA_CODE, AREA_NAME, CITY_CODE, CITY_NAME, SOURCE_TABLE, LEGACY_CODE, REMARKS,
       ACTIVE, CREATED_ON, COMPC, BRNCH, ROW_VER, UPDATED_BY, UPDATED_ON)
     VALUES (:id, :geoCode, :lvl, :zc, :zn, :tc, :tn, :ac, :an, :cc, :cn, 'APP', '-', NULL,
       'Y', :now, 1, :brnch, 1, :upd, :now)`,
    {
      id,
      geoCode: row.geoCode,
      lvl: row.level,
      zc: row.zoneCode,
      zn: row.zoneName,
      tc: row.territoryCode,
      tn: row.territoryName,
      ac: row.areaCode,
      an: row.areaName,
      cc: row.cityCode,
      cn: row.cityName,
      brnch: row.brnch,
      upd: usrid,
      now,
    },
  );
  return id;
}

/**
 * Rename a node: its own row and the copied name in every descendant (names are denormalised).
 * @returns {Promise<number>} rows changed (0 = version mismatch)
 */
export async function renameNode(tx, brnch, geoCode, level, rowVer, name, { usrid, now }) {
  const n = await tx.exec(
    `UPDATE GEO_HIERARCHY SET ${LEVEL_COLS[level].name} = :name, ROW_VER = ROW_VER + 1,
        UPDATED_BY = :upd, UPDATED_ON = :now
      WHERE BRNCH = :brnch AND GEO_CODE = :code AND ROW_VER = :ver`,
    { name, upd: usrid, now, brnch, code: geoCode, ver: rowVer },
  );
  if (n !== 1) return 0;
  await tx.exec(
    `UPDATE GEO_HIERARCHY SET ${LEVEL_COLS[level].name} = :name, UPDATED_BY = :upd, UPDATED_ON = :now
      WHERE BRNCH = :brnch AND GEO_CODE LIKE :pfx ESCAPE '\\'`,
    { name, upd: usrid, now, brnch, pfx: `${geoCode.replace(/[\\%_]/g, (m) => `\\${m}`)}-%` },
  );
  return n;
}

/** Set ACTIVE on a node, and (deactivate) on all of its descendants. */
export async function setActive(
  tx,
  brnch,
  geoCode,
  rowVer,
  active,
  withDescendants,
  { usrid, now },
) {
  const n = await tx.exec(
    `UPDATE GEO_HIERARCHY SET ACTIVE = :act, ROW_VER = ROW_VER + 1, UPDATED_BY = :upd, UPDATED_ON = :now
      WHERE BRNCH = :brnch AND GEO_CODE = :code AND ROW_VER = :ver`,
    { act: active ? 'Y' : 'N', upd: usrid, now, brnch, code: geoCode, ver: rowVer },
  );
  if (n !== 1) return { changed: 0, descendants: 0 };
  let descendants = 0;
  if (withDescendants) {
    descendants = await tx.exec(
      `UPDATE GEO_HIERARCHY SET ACTIVE = :act, ROW_VER = ROW_VER + 1, UPDATED_BY = :upd, UPDATED_ON = :now
        WHERE BRNCH = :brnch AND GEO_CODE LIKE :pfx ESCAPE '\\' AND ACTIVE <> :act`,
      {
        act: active ? 'Y' : 'N',
        upd: usrid,
        now,
        brnch,
        pfx: `${geoCode.replace(/[\\%_]/g, (m) => `\\${m}`)}-%`,
      },
    );
  }
  return { changed: n, descendants };
}

/**
 * LEGACY_MAP review (old geography code → GEO_CODE) with the node it points to.
 * @param {{ branches: number[], entity?: string, q?: string, page?: number, pageSize?: number }} o
 */
export async function listLegacyMap(tx, o) {
  const bf = branchFilter('m.BRNCH', o.branches);
  const where = [bf.sql];
  const binds = { ...bf.binds };
  if (o.entity) {
    where.push('m.ENTITY = :entity');
    binds.entity = o.entity;
  }
  if (o.q) {
    where.push(
      `(m.LEGACY_CODE = :qraw OR m.NEW_CODE LIKE :q ESCAPE '\\'
        OR UPPER(g.ZONE_NAME || ' ' || g.TERRITORY_NAME || ' ' || g.AREA_NAME || ' ' || g.CITY_NAME) LIKE :q ESCAPE '\\')`,
    );
    binds.q = `%${o.q.toUpperCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    binds.qraw = o.q;
  }
  const page = await paginate(tx, {
    sql: `SELECT m.BRNCH, m.ENTITY, m.LEGACY_CODE, m.NEW_CODE, m.SOURCE_DB, m.MAP_DATE,
                 g.GEO_LEVEL, g.ZONE_NAME, g.TERRITORY_NAME, g.AREA_NAME, g.CITY_NAME, g.ACTIVE
            FROM LEGACY_MAP m
            LEFT JOIN GEO_HIERARCHY g ON g.BRNCH = m.BRNCH AND g.GEO_CODE = m.NEW_CODE
           WHERE ${where.join(' AND ')}
           ORDER BY m.BRNCH, m.ENTITY, m.LEGACY_CODE`,
    binds,
    page: o.page,
    pageSize: o.pageSize,
  });
  return {
    ...page,
    items: page.items.map((r) => {
      const level = r.GEO_LEVEL === null ? null : Number(r.GEO_LEVEL);
      return {
        brnch: Number(r.BRNCH),
        entity: r.ENTITY,
        legacyCode: r.LEGACY_CODE,
        newCode: r.NEW_CODE,
        sourceDb: r.SOURCE_DB,
        mapDate: r.MAP_DATE ?? null,
        level,
        path: level
          ? [r.ZONE_NAME, r.TERRITORY_NAME, r.AREA_NAME, r.CITY_NAME].slice(0, level)
          : [],
        nodeActive: level ? r.ACTIVE === 'Y' : null,
        found: level !== null,
      };
    }),
  };
}

/** Counts per level and customer placement for one branch. */
export async function summary(tx, brnch) {
  const levels = await tx.many(
    `SELECT GEO_LEVEL, COUNT(*) AS TOTAL, SUM(CASE WHEN ACTIVE = 'Y' THEN 1 ELSE 0 END) AS ACT
       FROM GEO_HIERARCHY WHERE BRNCH = :brnch GROUP BY GEO_LEVEL ORDER BY GEO_LEVEL`,
    { brnch },
  );
  const cust = await tx.one(
    `SELECT COUNT(*) AS TOTAL, SUM(CASE WHEN GEO_CODE IS NULL THEN 1 ELSE 0 END) AS UNPLACED
       FROM CUSTOMER_INFO WHERE BRNCH = :brnch`,
    { brnch },
  );
  const entities = await tx.many(
    `SELECT ENTITY, COUNT(*) AS N FROM LEGACY_MAP WHERE BRNCH = :brnch GROUP BY ENTITY ORDER BY ENTITY`,
    { brnch },
  );
  return {
    brnch,
    levels: levels.map((l) => ({
      level: Number(l.GEO_LEVEL),
      total: Number(l.TOTAL),
      active: Number(l.ACT),
    })),
    customers: { total: Number(cust.TOTAL), unplaced: Number(cust.UNPLACED ?? 0) },
    legacyEntities: entities.map((e) => ({ entity: e.ENTITY, count: Number(e.N) })),
  };
}
