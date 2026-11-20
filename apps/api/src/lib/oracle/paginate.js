// Server-side pagination with ROWNUM (no FETCH FIRST / OFFSET: must run on 11g, CLAUDE.md rule 2).
import { Errors } from '../errors.js';

/**
 * Wrap an ordered query for one page. The inner SQL must contain its own ORDER BY with a unique
 * tie-breaker so pages are stable.
 * @param {import('./db.js').Tx} tx
 * @param {{ sql: string, binds?: Record<string, unknown>, page?: number, pageSize?: number, withTotal?: boolean }} q
 * @returns {Promise<{ items: Record<string, any>[], page: number, pageSize: number, total: number }>}
 */
export async function paginate(tx, { sql, binds = {}, page = 1, pageSize = 50, withTotal = true }) {
  const p = Math.max(1, Math.trunc(page));
  const size = Math.min(200, Math.max(1, Math.trunc(pageSize)));
  for (const k of Object.keys(binds)) {
    if (k.startsWith('rn_')) throw new Error(`Bind name ${k} is reserved by paginate`);
  }
  const pageSql = `SELECT * FROM (
  SELECT q__.*, ROWNUM AS RN__ FROM (${sql}) q__ WHERE ROWNUM <= :rn_max
) WHERE RN__ > :rn_min`;
  const rows = await tx.many(pageSql, { ...binds, rn_max: p * size, rn_min: (p - 1) * size });
  const items = rows.map(({ RN__: _rn, ...rest }) => rest);
  let total = items.length + (p - 1) * size;
  if (withTotal) {
    const c = await tx.one(`SELECT COUNT(*) AS N FROM (${sql})`, binds);
    total = Number(c.N);
  }
  return { items, page: p, pageSize: size, total };
}

/**
 * Turn an API sort string (`"name"` or `"-createdOn"`) into an ORDER BY clause using an allow-list
 * (CLAUDE.md rule 4: column names only from allow-lists).
 * @param {string|undefined} sort
 * @param {Record<string, string>} allowed apiName → SQL column
 * @param {string} fallback default ORDER BY body
 * @param {string} tieBreaker unique column(s) appended for stable pages
 */
export function orderBy(sort, allowed, fallback, tieBreaker) {
  let body = fallback;
  if (sort) {
    const desc = sort.startsWith('-');
    const name = desc ? sort.slice(1) : sort;
    const col = allowed[name];
    if (!col) throw Errors.validation(`Cannot sort by ${name}`);
    body = `${col} ${desc ? 'DESC' : 'ASC'}`;
  }
  return `ORDER BY ${body}, ${tieBreaker}`;
}
