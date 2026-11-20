// SQL for customers (TASKS P1-03). CUSTOMER_INFO columns come from the shared field registry
// (allow-list); values are bound. Every query is branch-scoped (BR-BR-04).
import { CUSTOMER_FIELDS, customerStatus } from '@dcl/shared';
import { branchFilter } from '../../lib/branch-scope.js';
import { orderBy, paginate } from '../../lib/oracle/paginate.js';
import { toApi, toDb } from '../masters/repo.js';

const META_COLS = [
  'c.BRNCH',
  'c.CUSTOMER_CODE',
  'c.ZONE_CODE',
  'c.TERRITORY_CODE',
  'c.AREA_CODE',
  'c.GEO_CODE',
  'c.GEO_SOURCE',
  'c.DOC_STATUS',
  'c.CLOSED',
  'c.ACTIVE',
  'c.ROW_VER',
  'c.CREATED_BY',
  'c.CREATED_ON',
  'c.UPDATED_BY',
  'c.UPDATED_ON',
  'c.APPROVED_BY',
  'c.APPROVED_ON',
  'c.ENTER_BY',
];
const FIELD_COLS = CUSTOMER_FIELDS.map((f) => `c.${f.col}`);
/** Status as SQL (legacy rows have no DOC_STATUS, see customerStatus). */
export const STATUS_SQL = `NVL(c.DOC_STATUS, CASE WHEN c.CLOSED = 'Y' THEN 'CLOSED' ELSE 'APPROVED' END)`;
const GEO_JOIN = `LEFT JOIN GEO_HIERARCHY g ON g.BRNCH = c.BRNCH AND g.GEO_CODE = c.GEO_CODE
  LEFT JOIN CHANNEL_DESC ch ON ch.BRNCH = c.BRNCH AND ch.CHANNEL_CODE = c.CHANNEL_CODE
  LEFT JOIN ZONE_DESC zd ON zd.BRNCH = c.BRNCH AND zd.ZONE_CODE = c.ZONE_CODE`;
const GEO_COLS = `g.GEO_LEVEL, g.ZONE_NAME, g.TERRITORY_NAME, g.AREA_NAME, g.CITY_NAME, ch.CHANNEL_DESC AS CHANNEL_NAME, zd.ZONE_NAME AS CUST_ZONE_NAME`;

/** @param {Record<string, any>} r */
export function mapCustomer(r) {
  if (!r) return null;
  /** @type {Record<string, any>} */
  const out = {
    brnch: Number(r.BRNCH),
    customerCode: r.CUSTOMER_CODE,
    status: customerStatus({ docStatus: r.DOC_STATUS, closed: r.CLOSED }),
    // legacy ACTIVE: 'N' = inactive; empty (most legacy rows) = active
    active: r.ACTIVE !== 'N',
    geoCode: r.GEO_CODE ?? null,
    geoSource: r.GEO_SOURCE ?? null,
    geoPath:
      r.GEO_LEVEL === null || r.GEO_LEVEL === undefined
        ? []
        : [r.ZONE_NAME, r.TERRITORY_NAME, r.AREA_NAME, r.CITY_NAME].slice(0, Number(r.GEO_LEVEL)),
    channelName: r.CHANNEL_NAME ?? null,
    zoneCode: r.ZONE_CODE ?? null,
    zoneName: r.CUST_ZONE_NAME ?? null,
    rowVer: Number(r.ROW_VER),
    createdBy: r.CREATED_BY ?? r.ENTER_BY ?? null,
    createdOn: r.CREATED_ON ?? null,
    updatedBy: r.UPDATED_BY ?? null,
    updatedOn: r.UPDATED_ON ?? null,
    approvedBy: r.APPROVED_BY ?? null,
    approvedOn: r.APPROVED_ON ?? null,
  };
  for (const f of CUSTOMER_FIELDS) out[f.name] = toApi(f, r[f.col]);
  return out;
}

const SORTABLE = {
  customerCode: 'c.CUSTOMER_CODE',
  customerName: 'c.CUSTOMER_NAME',
  channelCode: 'c.CHANNEL_CODE',
  status: STATUS_SQL,
  createdOn: 'c.CREATED_ON',
};

/**
 * @param {import('../../lib/oracle/db.js').Tx} tx
 * @param {{ branches: number[], q?: string, channel?: string, status?: string, geoCode?: string, page?: number, pageSize?: number, sort?: string }} o
 */
export async function listCustomers(tx, o) {
  const bf = branchFilter('c.BRNCH', o.branches);
  const where = [bf.sql];
  const binds = { ...bf.binds };
  if (o.q) {
    where.push(
      `(UPPER(c.CUSTOMER_NAME) LIKE :q ESCAPE '\\' OR c.CUSTOMER_CODE LIKE :q ESCAPE '\\'
        OR c.MOBILE_NO LIKE :q ESCAPE '\\' OR c.NTN LIKE :q ESCAPE '\\')`,
    );
    binds.q = `%${o.q.toUpperCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  }
  if (o.channel) {
    where.push('c.CHANNEL_CODE = :ch');
    binds.ch = o.channel;
  }
  if (o.status) {
    where.push(`${STATUS_SQL} = :st`);
    binds.st = o.status;
  }
  if (o.geoCode) {
    where.push(`(c.GEO_CODE = :geo OR c.GEO_CODE LIKE :geoPfx ESCAPE '\\')`);
    binds.geo = o.geoCode;
    binds.geoPfx = `${o.geoCode.replace(/[\\%_]/g, (m) => `\\${m}`)}-%`;
  }
  const page = await paginate(tx, {
    sql: `SELECT ${[...META_COLS, ...FIELD_COLS].join(', ')}, ${GEO_COLS}
            FROM CUSTOMER_INFO c ${GEO_JOIN}
           WHERE ${where.join(' AND ')}
           ${orderBy(o.sort, SORTABLE, 'c.CUSTOMER_CODE', 'c.BRNCH, c.CUSTOMER_CODE')}`,
    binds,
    page: o.page,
    pageSize: o.pageSize,
  });
  return { ...page, items: page.items.map(mapCustomer) };
}

export async function getCustomer(tx, brnch, code, { forUpdate = false } = {}) {
  if (forUpdate) {
    const locked = await tx.one(
      'SELECT CUSTOMER_CODE FROM CUSTOMER_INFO WHERE BRNCH = :b AND CUSTOMER_CODE = :c FOR UPDATE',
      { b: brnch, c: code },
    );
    if (!locked) return null;
  }
  const r = await tx.one(
    `SELECT ${[...META_COLS, ...FIELD_COLS].join(', ')}, ${GEO_COLS}
       FROM CUSTOMER_INFO c ${GEO_JOIN}
      WHERE c.BRNCH = :b AND c.CUSTOMER_CODE = :c`,
    { b: brnch, c: code },
  );
  return mapCustomer(r);
}

/** Existing codes under a prefix (for the BR-CUS-03 sequence). */
export async function codesWithPrefix(tx, brnch, prefix) {
  const rows = await tx.many(
    `SELECT CUSTOMER_CODE FROM CUSTOMER_INFO WHERE BRNCH = :b AND CUSTOMER_CODE LIKE :p ESCAPE '\\'`,
    { b: brnch, p: `${prefix.replace(/[\\%_]/g, (m) => `\\${m}`)}%` },
  );
  return rows.map((r) => r.CUSTOMER_CODE);
}

/**
 * @param {{ brnch: number, code: string, zone: string, territory: string, area: string, geoCode: string, values: Record<string, any> }} c
 */
export async function insertCustomer(tx, c, { usrid, now }) {
  const cols = [
    'COMPC',
    'BRNCH',
    'CUSTOMER_CODE',
    'ZONE_CODE',
    'TERRITORY_CODE',
    'AREA_CODE',
    'GEO_CODE',
    'GEO_SOURCE',
    'DOC_STATUS',
    'ACTIVE',
    'CLOSED',
    'ROW_VER',
    'CREATED_BY',
    'CREATED_ON',
    'ENTER_BY',
  ];
  const marks = [
    '1',
    ':b',
    ':code',
    ':zc',
    ':tc',
    ':ac',
    ':geo',
    `'MANUAL'`,
    `'PENDING_APPROVAL'`,
    `'Y'`,
    `'N'`,
    '1',
    ':usr',
    ':now',
    ':enter',
  ];
  const binds = {
    b: c.brnch,
    code: c.code,
    zc: c.zone,
    tc: c.territory,
    ac: c.area,
    geo: c.geoCode,
    usr: usrid,
    now,
    enter: usrid.slice(0, 10),
  };
  CUSTOMER_FIELDS.forEach((f, i) => {
    if (!(f.name in c.values) && f.kind !== 'yn' && f.kind !== 'flag01') return;
    cols.push(f.col);
    marks.push(`:f${i}`);
    binds[`f${i}`] = toDb(f, c.values[f.name]);
  });
  await tx.exec(
    `INSERT INTO CUSTOMER_INFO (${cols.join(', ')}) VALUES (${marks.join(', ')})`,
    binds,
  );
}

/** Apply field values with the optimistic lock. @returns {Promise<boolean>} */
export async function updateFields(tx, brnch, code, rowVer, values, { usrid, now }) {
  const sets = ['ROW_VER = ROW_VER + 1', 'UPDATED_BY = :usr', 'UPDATED_ON = :now'];
  const binds = { b: brnch, c: code, ver: rowVer, usr: usrid, now };
  CUSTOMER_FIELDS.forEach((f, i) => {
    if (!(f.name in values)) return;
    sets.push(`${f.col} = :f${i}`);
    binds[`f${i}`] = toDb(f, values[f.name]);
  });
  const n = await tx.exec(
    `UPDATE CUSTOMER_INFO SET ${sets.join(', ')} WHERE BRNCH = :b AND CUSTOMER_CODE = :c AND ROW_VER = :ver`,
    binds,
  );
  return n === 1;
}

/** Set the status (and approval stamp when approving). */
export async function setStatus(tx, brnch, code, status, { usrid, now, approved = false }) {
  await tx.exec(
    `UPDATE CUSTOMER_INFO SET DOC_STATUS = :st, ROW_VER = ROW_VER + 1, UPDATED_BY = :usr, UPDATED_ON = :now
       ${approved ? ', APPROVED_BY = :usr, APPROVED_ON = :now' : ''}
     WHERE BRNCH = :b AND CUSTOMER_CODE = :c`,
    { st: status, usr: usrid, now, b: brnch, c: code },
  );
}

export async function insertBlock(tx, row, { usrid, now }) {
  const id = await tx.nextId('SEQ_CUSTOMER_BLOCK');
  await tx.exec(
    `INSERT INTO CUSTOMER_BLOCK (BLOCK_ID, COMPC, BRNCH, CUSTOMER_CODE, ACTION, STOP_DISPATCH, REASON, CREATED_BY, CREATED_ON)
     VALUES (:id, 1, :b, :c, :act, :stop, :reason, :usr, :now)`,
    {
      id,
      b: row.brnch,
      c: row.code,
      act: row.action,
      stop: row.stopDispatch ? 'Y' : 'N',
      reason: row.reason,
      usr: usrid,
      now,
    },
  );
  return id;
}

/** Block history (new system) + legacy groups (BLOCK_CUSTOMER, read-only). */
export async function blocks(tx, brnch, code) {
  const history = await tx.many(
    `SELECT BLOCK_ID, ACTION, STOP_DISPATCH, REASON, CREATED_BY, CREATED_ON FROM CUSTOMER_BLOCK
      WHERE BRNCH = :b AND CUSTOMER_CODE = :c ORDER BY BLOCK_ID DESC`,
    { b: brnch, c: code },
  );
  const legacy = await tx.many(
    `SELECT b.G_CODE, g.G_NAME, b.REMS FROM BLOCK_CUSTOMER b
       LEFT JOIN BLOCK_CUSTOMER_GROUP g ON g.BRNCH = b.BRNCH AND g.G_CODE = b.G_CODE
      WHERE b.BRNCH = :b AND b.B_CUSTOMER_CODE = :c ORDER BY g.SORT, b.G_CODE`,
    { b: brnch, c: code },
  );
  return {
    history: history.map((h) => ({
      blockId: Number(h.BLOCK_ID),
      action: h.ACTION,
      stopDispatch: h.STOP_DISPATCH === 'Y',
      reason: h.REASON,
      by: h.CREATED_BY,
      on: h.CREATED_ON,
    })),
    legacyGroups: legacy.map((l) => ({
      group: l.G_CODE,
      name: l.G_NAME ?? null,
      remarks: l.REMS ?? null,
    })),
  };
}

/** Pending CUSTOMER_APPROVE request for a customer, if any. */
export async function pendingRequest(tx, brnch, code) {
  const r = await tx.one(
    `SELECT REQ_ID, ACTION, REQUESTED_BY, REQUESTED_ON FROM APPROVAL_REQUEST
      WHERE DOC_TYPE = 'CUSTOMER_APPROVE' AND DOC_KEY = :k AND STATUS = 'PENDING'`,
    { k: `${brnch}|${code}` },
  );
  return r
    ? {
        requestId: Number(r.REQ_ID),
        action: r.ACTION,
        requestedBy: r.REQUESTED_BY,
        requestedOn: r.REQUESTED_ON,
      }
    : null;
}
