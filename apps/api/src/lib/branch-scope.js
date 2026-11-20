// Branch scope helpers (BR-BR-04, PERMISSIONS P-4): every repo query on business data filters
// `BRNCH IN (:allowed)`. Branch lists come from the session, never from the request alone.
import { Errors } from './errors.js';

/**
 * Build `col IN (:br0, :br1)` with binds for the allowed branches.
 * @param {string} col SQL column (constant, e.g. 'o.BRNCH')
 * @param {number[]} branches allowed branches (non-empty)
 * @param {string} [prefix] bind name prefix
 */
export function branchFilter(col, branches, prefix = 'br') {
  if (!Array.isArray(branches) || branches.length === 0) {
    // no branch → no data; a safe always-false condition instead of an unscoped query
    return { sql: '1 = 0', binds: {} };
  }
  const binds = {};
  const names = branches.map((b, i) => {
    if (!Number.isInteger(b)) throw new Error(`Bad branch ${b}`);
    binds[`${prefix}${i}`] = b;
    return `:${prefix}${i}`;
  });
  return { sql: `${col} IN (${names.join(', ')})`, binds };
}

/**
 * Resolve the branches a list request may see: the requested one (must be allowed) or the
 * current session branch. `all` = every allowed branch.
 * @param {{ allowedBranches: number[], brnch: number }} session
 * @param {string|number|undefined} requested
 */
export function resolveListBranches(session, requested) {
  if (requested === undefined || requested === null || requested === '') return [session.brnch];
  if (requested === 'all') return [...session.allowedBranches];
  const b = Number(requested);
  if (!session.allowedBranches.includes(b)) throw Errors.branchForbidden(b);
  return [b];
}
