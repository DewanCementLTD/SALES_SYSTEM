// Integration-test database access. Tests run on the shared SALES_NEW schema and must never
// leave rows behind: use `inRollback` for everything that writes (user decision 19 Nov 2026).
import { loadTestConfig } from '../../src/config.js';
import { createDb } from '../../src/lib/oracle/db.js';

/** @type {Promise<import('../../src/lib/oracle/db.js').Db> | null} */
let dbPromise = null;

export function testConfig() {
  return loadTestConfig();
}

export function getTestDb() {
  if (!dbPromise) dbPromise = createDb(testConfig());
  return dbPromise;
}

/**
 * Run `fn` in a transaction that is always rolled back.
 * @template T
 * @param {(tx: import('../../src/lib/oracle/db.js').Tx) => Promise<T>} fn
 */
export async function inRollback(fn) {
  const db = await getTestDb();
  return db.withTx(fn, { usrid: 'vitest', action: 'test', rollback: true });
}

export async function closeTestDb() {
  if (!dbPromise) return;
  const db = await dbPromise;
  dbPromise = null;
  await db.close(0);
}

/** Branch/year/doc type that no real document uses, for numbering tests. */
export const TEST_SEQ = { brnch: 9, year: 2099 };
