// SQL for simple masters (TASKS P1-01). Table and column names come only from the registry in
// @dcl/shared (CLAUDE.md rule 4: allow-lists); values are always bound. Bind names are generated
// (:k0, :f0 …) so no column can collide with an Oracle reserved word.
import { businessDate, dec } from '@dcl/shared';
import { branchFilter } from '../../lib/branch-scope.js';
import { orderBy, paginate } from '../../lib/oracle/paginate.js';

const META = ['BRNCH'];

/** @param {import('@dcl/shared').MasterDef} def */
function selectList(def) {
  const cols = [...META, ...def.key.map((k) => k.col), ...def.fields.map((f) => f.col)];
  if (def.hasActive) cols.push('ACTIVE', 'ROW_VER', 'UPDATED_BY', 'UPDATED_ON');
  return cols.join(', ');
}

/** DB value → API value by field kind. */
function toApi(f, v) {
  if (v === null || v === undefined) return f.kind === 'flag01' ? false : null;
  switch (f.kind) {
    case 'int':
      return Number(v);
    case 'decimal':
      return dec(v).toFixed(f.scale ?? 2);
    case 'flag01':
      return Number(v) === 1;
    case 'date':
      return businessDate(v);
    case 'ref':
    case 'enum':
    case 'text':
      return String(v);
    default:
      return v;
  }
}

/** API value → bind value by field kind. */
function toDb(f, v) {
  if (v === null || v === undefined) return f.kind === 'flag01' ? 0 : null;
  if (f.kind === 'flag01') return v ? 1 : 0;
  if (f.kind === 'decimal') return dec(v).toString();
  if (f.kind === 'date') return new Date(`${v}T00:00:00+05:00`);
  return v;
}

/** @param {import('@dcl/shared').MasterDef} def */
export function mapRow(def, row) {
  if (!row) return null;
  /** @type {Record<string, any>} */
  const out = { brnch: Number(row.BRNCH) };
  for (const f of [...def.key, ...def.fields]) out[f.name] = toApi(f, row[f.col]);
  if (def.hasActive) {
    out.active = row.ACTIVE === 'Y';
    out.rowVer = Number(row.ROW_VER);
    out.updatedBy = row.UPDATED_BY ?? null;
    out.updatedOn = row.UPDATED_ON ?? null;
  } else {
    out.active = true;
    out.rowVer = 1;
    out.updatedBy = null;
    out.updatedOn = null;
  }
  return out;
}

function keyWhere(def, key) {
  const binds = {};
  const sql = def.key
    .map((k, i) => {
      binds[`k${i}`] = key[k.name];
      return `${k.col} = :k${i}`;
    })
    .join(' AND ');
  return { sql, binds };
}

/**
 * @param {import('../../lib/oracle/db.js').Tx} tx
 * @param {import('@dcl/shared').MasterDef} def
 * @param {{ branches: number[], q?: string, active?: boolean, page?: number, pageSize?: number, sort?: string, filters?: Record<string, string> }} opts
 */
export async function list(tx, def, opts) {
  const bf = branchFilter('BRNCH', opts.branches);
  const where = [bf.sql];
  const binds = { ...bf.binds };
  if (opts.q) {
    const searchCols = [...def.key, ...def.fields.filter((f) => f.kind === 'text' && f.list)].map(
      (f) => (f.kind === 'int' ? `TO_CHAR(${f.col})` : `UPPER(${f.col})`),
    );
    where.push(`(${searchCols.map((c) => `${c} LIKE :q ESCAPE '\\'`).join(' OR ')})`);
    binds.q = `%${opts.q.toUpperCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  }
  if (def.hasActive && opts.active !== undefined) {
    where.push('ACTIVE = :act');
    binds.act = opts.active ? 'Y' : 'N';
  }
  for (const [i, [name, value]] of Object.entries(opts.filters ?? {}).entries()) {
    const f = [...def.key, ...def.fields].find((x) => x.name === name);
    if (!f) continue;
    where.push(`${f.col} = :flt${i}`);
    binds[`flt${i}`] = f.kind === 'int' ? Number(value) : value;
  }
  const sortable = Object.fromEntries(
    [...def.key, ...def.fields]
      .filter((f) => f.list || def.key.includes(f))
      .map((f) => [f.name, f.col]),
  );
  const order = orderBy(
    opts.sort,
    sortable,
    def.orderBy,
    ['BRNCH', ...def.key.map((k) => k.col)].join(', '),
  );
  const page = await paginate(tx, {
    sql: `SELECT ${selectList(def)} FROM ${def.table} WHERE ${where.join(' AND ')} ${order}`,
    binds,
    page: opts.page,
    pageSize: opts.pageSize,
  });
  return { ...page, items: page.items.map((r) => mapRow(def, r)) };
}

/**
 * @param {import('../../lib/oracle/db.js').Tx} tx
 * @param {import('@dcl/shared').MasterDef} def
 * @param {number} brnch
 * @param {Record<string, string|number>} key
 */
export async function get(tx, def, brnch, key, { forUpdate = false } = {}) {
  const kw = keyWhere(def, key);
  const row = await tx.one(
    `SELECT ${selectList(def)} FROM ${def.table} WHERE BRNCH = :brnch AND ${kw.sql}${forUpdate ? ' FOR UPDATE' : ''}`,
    { brnch, ...kw.binds },
  );
  return mapRow(def, row);
}

/** Next number for an auto-numbered column (per branch). The unique key catches a race. */
export async function nextNumber(tx, def, col, brnch) {
  const r = await tx.one(
    `SELECT NVL(MAX(${col}), 0) + 1 AS N FROM ${def.table} WHERE BRNCH = :brnch`,
    {
      brnch,
    },
  );
  return Number(r.N);
}

/** Does a value exist in a referenced master (same branch)? */
export async function refExists(tx, refDef, brnch, value) {
  const k = refDef.key[0];
  const r = await tx.one(
    `SELECT COUNT(*) AS N FROM ${refDef.table} WHERE BRNCH = :brnch AND ${k.col} = :v AND ROWNUM = 1`,
    { brnch, v: k.kind === 'int' ? Number(value) : value },
  );
  return Number(r.N) > 0;
}

export async function productCodeExists(tx, brnch, value) {
  const r = await tx.one(
    'SELECT COUNT(*) AS N FROM PRODUCT_DESC_T WHERE BRNCH = :brnch AND PRODUCT_CODE = :v AND ROWNUM = 1',
    { brnch, v: value },
  );
  return Number(r.N) > 0;
}

/** @param {Record<string, any>} values API values for key + fields */
export async function insert(tx, def, brnch, values, { usrid, now }) {
  const cols = ['COMPC', 'BRNCH'];
  const marks = [':compc', ':brnch'];
  const binds = { compc: 1, brnch };
  [...def.key, ...def.fields].forEach((f, i) => {
    cols.push(f.col);
    marks.push(`:f${i}`);
    binds[`f${i}`] = toDb(f, values[f.name]);
  });
  cols.push('ACTIVE', 'ROW_VER', 'UPDATED_BY', 'UPDATED_ON');
  marks.push(`'Y'`, '1', ':upd', ':now');
  Object.assign(binds, { upd: usrid, now });
  await tx.exec(
    `INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${marks.join(', ')})`,
    binds,
  );
}

/** Update fields with optimistic lock. @returns {Promise<boolean>} false = version mismatch */
export async function update(tx, def, brnch, key, rowVer, values, { usrid, now }) {
  const kw = keyWhere(def, key);
  const sets = [];
  const binds = { brnch, ver: rowVer, upd: usrid, now, ...kw.binds };
  def.fields.forEach((f, i) => {
    if (!(f.name in values)) return;
    sets.push(`${f.col} = :f${i}`);
    binds[`f${i}`] = toDb(f, values[f.name]);
  });
  sets.push('ROW_VER = ROW_VER + 1', 'UPDATED_BY = :upd', 'UPDATED_ON = :now');
  const n = await tx.exec(
    `UPDATE ${def.table} SET ${sets.join(', ')} WHERE BRNCH = :brnch AND ${kw.sql} AND ROW_VER = :ver`,
    binds,
  );
  return n === 1;
}

export async function setActive(tx, def, brnch, key, rowVer, active, { usrid, now }) {
  const kw = keyWhere(def, key);
  const n = await tx.exec(
    `UPDATE ${def.table} SET ACTIVE = :act, ROW_VER = ROW_VER + 1, UPDATED_BY = :upd, UPDATED_ON = :now
      WHERE BRNCH = :brnch AND ${kw.sql} AND ROW_VER = :ver`,
    { act: active ? 'Y' : 'N', brnch, ver: rowVer, upd: usrid, now, ...kw.binds },
  );
  return n === 1;
}

/**
 * Lookup rows (value, label, active) for one branch.
 * @returns {Promise<{ value: string, label: string, active: boolean }[]>}
 */
export async function lookup(tx, def, brnch) {
  const k = def.key[0];
  const label = [...def.key, ...def.fields].find((f) => f.name === def.labelField);
  const rows = await tx.many(
    `SELECT ${k.col} AS V, ${label.col} AS L${def.hasActive ? ', ACTIVE' : ''} FROM ${def.table}
      WHERE BRNCH = :brnch ORDER BY ${def.orderBy}`,
    { brnch },
  );
  return rows.map((r) => ({
    value: String(r.V),
    label: r.L === null ? String(r.V) : String(r.L),
    active: def.hasActive ? r.ACTIVE === 'Y' : true,
  }));
}

/** Product codes with the name of their latest period (for DO types, quotes …). */
export async function productCodes(tx, brnch) {
  const rows = await tx.many(
    `SELECT p.PRODUCT_CODE AS V, p.PRODUCT_NAME AS L FROM PRODUCT_DESC_T p
      WHERE p.BRNCH = :brnch
        AND p.PERIOD# = (SELECT MAX(x.PERIOD#) FROM PRODUCT_DESC_T x WHERE x.BRNCH = p.BRNCH AND x.PRODUCT_CODE = p.PRODUCT_CODE)
      ORDER BY p.PRODUCT_CODE`,
    { brnch },
  );
  return rows.map((r) => ({ value: r.V, label: r.L, active: true }));
}
