// One geography for both branches: Zone → Territory → Area → City (SCHEMA §2.3, TASKS P1-02).
// GEO_CODE is the readable path `Z<zone>-T<territory>-A<area>-C<city>`, unique per branch.
import { z } from 'zod';

export const GEO_LEVELS = Object.freeze([
  { level: 1, name: 'Zone', plural: 'Zones', prefix: 'Z', field: 'zone' },
  { level: 2, name: 'Territory', plural: 'Territories', prefix: 'T', field: 'territory' },
  { level: 3, name: 'Area', plural: 'Areas', prefix: 'A', field: 'area' },
  { level: 4, name: 'City', plural: 'Cities', prefix: 'C', field: 'city' },
]);

const PART = /^[A-Z0-9]+$/;

/**
 * Split a GEO_CODE into its level codes.
 * @param {string} geoCode e.g. `Z1-T12-A1-C389`
 * @returns {{ level: number, zone: string, territory: string|null, area: string|null, city: string|null }|null}
 */
export function parseGeoCode(geoCode) {
  const parts = String(geoCode ?? '').split('-');
  if (parts.length < 1 || parts.length > 4) return null;
  /** @type {Record<string, string|null>} */
  const out = { zone: null, territory: null, area: null, city: null };
  for (const [i, p] of parts.entries()) {
    const lv = GEO_LEVELS[i];
    if (!p.startsWith(lv.prefix)) return null;
    const code = p.slice(1);
    if (!code || !PART.test(code)) return null;
    out[lv.field] = code;
  }
  return { level: parts.length, .../** @type {any} */ (out) };
}

/**
 * GEO_CODE of a new child node.
 * @param {string|null} parentCode null for a zone
 * @param {string} code the node's own code (letters/digits)
 */
export function childGeoCode(parentCode, code) {
  const level = parentCode ? parentCode.split('-').length + 1 : 1;
  if (level > 4) throw new Error('A city has no children');
  const own = `${GEO_LEVELS[level - 1].prefix}${code}`;
  return parentCode ? `${parentCode}-${own}` : own;
}

/** True when `code` is `ancestor` itself or below it. */
export const isGeoWithin = (code, ancestor) => code === ancestor || code.startsWith(`${ancestor}-`);

export const zGeoNodeCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(PART, 'Use letters and digits only')
  .max(10);

export const zGeoName = z.string().trim().min(2, 'Enter a name').max(100);

/** Create body: parentCode empty = new zone. */
export const zGeoCreate = z.object({
  parentCode: z
    .string()
    .trim()
    .max(50)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  code: zGeoNodeCode,
  name: zGeoName,
});

export const zGeoRename = z.object({ name: zGeoName });
