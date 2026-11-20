// APP_SETTING access (TASKS P0-11): branch row wins over company row (BRNCH 0), which wins over
// the code default in packages/shared/settings-keys.js. Cached per request only.
import { SETTINGS, parseSettingValue } from '@dcl/shared';

/** Per-request settings reader. */
export class SettingsReader {
  /** @param {import('../../lib/oracle/db.js').Tx} tx */
  constructor(tx) {
    this.tx = tx;
    /** @type {Map<string, string|null>} */
    this.cache = new Map();
  }

  /** Raw stored string for (branch, key) with fallback. */
  async raw(brnch, key) {
    const def = SETTINGS[key];
    if (!def) throw new Error(`Unknown setting ${key}`);
    const ck = `${brnch}|${key}`;
    if (this.cache.has(ck)) return this.cache.get(ck);
    const row = await this.tx.one(
      `SELECT SETTING_VALUE FROM APP_SETTING
        WHERE SETTING_KEY = :k AND BRNCH IN (0, :b)
        ORDER BY BRNCH DESC`,
      { k: key, b: brnch ?? 0 },
    );
    const value = row ? row.SETTING_VALUE : def.def === '' ? null : def.def;
    this.cache.set(ck, value);
    return value;
  }

  /** Typed value (NUMBER stays a string; use num()). */
  async get(brnch, key) {
    return parseSettingValue(await this.raw(brnch, key), SETTINGS[key].type);
  }

  async num(brnch, key) {
    const v = await this.raw(brnch, key);
    return v === null ? null : Number(v);
  }

  async bool(brnch, key) {
    return (await this.raw(brnch, key)) === 'Y';
  }
}

/**
 * All settings for a branch view: company default, branch override and effective value.
 * @param {import('../../lib/oracle/db.js').Tx} tx
 * @param {number} brnch 0 = company level
 */
export async function listSettings(tx, brnch) {
  const rows = await tx.many(
    `SELECT BRNCH, SETTING_KEY, SETTING_VALUE, VALUE_TYPE, DESCR, UPDATED_BY, UPDATED_ON
       FROM APP_SETTING WHERE BRNCH IN (0, :b)`,
    { b: brnch },
  );
  const byKey = new Map();
  for (const r of rows) {
    const e = byKey.get(r.SETTING_KEY) ?? {};
    if (r.BRNCH === 0) e.company = r;
    else e.branch = r;
    byKey.set(r.SETTING_KEY, e);
  }
  return Object.values(SETTINGS).map((def) => {
    const e = byKey.get(def.key) ?? {};
    const src = e.branch ?? e.company;
    return {
      key: def.key,
      type: def.type,
      rule: def.rule,
      openQuestion: def.openQ ?? null,
      description: def.descr,
      perBranch: Boolean(def.perBranch),
      secret: Boolean(def.secret),
      companyValue: def.secret ? null : (e.company?.SETTING_VALUE ?? null),
      branchValue: def.secret ? null : (e.branch?.SETTING_VALUE ?? null),
      value: def.secret
        ? src?.SETTING_VALUE
          ? '••••'
          : null
        : (src?.SETTING_VALUE ?? (def.def || null)),
      source: e.branch ? 'branch' : e.company ? 'company' : 'default',
      updatedBy: src?.UPDATED_BY ?? null,
      updatedOn: src?.UPDATED_ON ?? null,
    };
  });
}

/** Validate a value against the setting type. @returns {string|null} error text */
export function settingValueProblem(key, value) {
  const def = SETTINGS[key];
  if (!def) return `Unknown setting ${key}`;
  if (value === null || value === '') return null;
  if (def.type === 'NUMBER' && !/^-?\d+(\.\d+)?$/.test(value)) return 'Must be a number';
  if (def.type === 'BOOL' && !['Y', 'N'].includes(value)) return 'Must be Y or N';
  if (def.type === 'JSON') {
    try {
      JSON.parse(value);
    } catch {
      return 'Must be valid JSON';
    }
  }
  if (key === 'INVOICE_QTY_BASIS' && !['NET_WEIGHT', 'BAGS'].includes(value))
    return 'Must be NET_WEIGHT or BAGS';
  if (key === 'FBR_ENV' && !['SANDBOX', 'PRODUCTION'].includes(value))
    return 'Must be SANDBOX or PRODUCTION';
  return null;
}
