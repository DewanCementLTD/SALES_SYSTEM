import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, getTestDb } from '../../../test/helpers/db.js';
import { planMigrations, runMigrations } from './runner.js';

const dbDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../db');

afterAll(closeTestDb);

describe('migration runner (P0-04)', () => {
  it('schema is up to date: 05 and every db/migrations file is recorded', async () => {
    const db = await getTestDb();
    const plan = await planMigrations(db, dbDir);
    expect(plan.pending.map((p) => p.version)).toEqual([]);
    expect(plan.applied).toEqual(expect.arrayContaining(['05', '001', '002']));
  });

  it('running again is a no-op', async () => {
    const db = await getTestDb();
    const res = await runMigrations(db, { dbDir });
    expect(res).toEqual({ applied: [], baselined: [] });
  });

  it('refuses to run as SYS/SYSTEM', async () => {
    const fake = {
      read: async (fn) => fn({ one: async () => ({ U: 'SYSTEM' }) }),
    };
    await expect(runMigrations(/** @type {any} */ (fake), { dbDir })).rejects.toThrow(
      /SYS\/SYSTEM/,
    );
  });
});
