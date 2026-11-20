// Small HTTP helpers shared by route modules.
import { Errors } from './errors.js';

/** ETag for a row version (API_SPEC §1 Concurrency). */
export const etag = (rowVer) => `"${rowVer}"`;

/**
 * Row version the client edited, from `If-Match` (required on PUT/PATCH/state commands).
 * @returns {number}
 */
export function ifMatch(request) {
  const h = request.headers['if-match'];
  if (!h) throw Errors.validation('If-Match header with the record version is required');
  const m = /^(?:W\/)?"?(\d+)"?$/.exec(String(h).trim());
  if (!m) throw Errors.validation('If-Match must be the ETag returned by GET');
  return Number(m[1]);
}

/** Throw 404 when a lookup came back empty. */
export function found(row, what) {
  if (!row) throw Errors.notFound(what);
  return row;
}
