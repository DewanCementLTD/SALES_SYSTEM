// Migration runner (TASKS P0-04): applies db/05_NEW_SYSTEM_TABLES.sql (version '05') if missing,
// then db/migrations/NNN_*.sql in order, recording each in SCHEMA_VERSION with a sha256 checksum.
// DDL commits implicitly in Oracle, so a failed file is NOT recorded and must be fixed and re-run
// (migration files are written to be re-runnable: "already exists" errors are ignored).
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { splitSqlScript } from './parse-sql.js';

/** "Already exists" errors that make a re-run harmless (same list the scripts document). */
export const ALREADY_EXISTS_ERRORS = new Set([
  955, // name is already used by an existing object
  1430, // column being added already exists
  1408, // such column list already indexed
  2260, // table can have only one primary key
  2261, // such unique or primary key already exists
  2275, // such a referential constraint already exists
  1442, // column to be modified to NOT NULL is already NOT NULL
  2264, // name already used by an existing constraint
]);

const FILE_RE = /^(\d{3})_([A-Za-z0-9_]+)\.sql$/;

export const checksum = (text) =>
  createHash('sha256').update(text.replace(/\r\n?/g, '\n')).digest('hex');

/**
 * @param {string} dbDir path of the repo `db/` folder
 * @returns {Promise<{ version: string, description: string, file: string }[]>}
 */
export async function listMigrations(dbDir) {
  const files = [
    {
      version: '05',
      description: 'New system tables and columns',
      file: path.join(dbDir, '05_NEW_SYSTEM_TABLES.sql'),
    },
  ];
  const migDir = path.join(dbDir, 'migrations');
  const names = (await readdir(migDir)).filter((n) => n.endsWith('.sql')).sort();
  const seen = new Set();
  for (const name of names) {
    const m = FILE_RE.exec(name);
    if (!m) throw new Error(`Migration file name must be NNN_NAME.sql: ${name}`);
    if (seen.has(m[1])) throw new Error(`Duplicate migration number ${m[1]}`);
    seen.add(m[1]);
    files.push({
      version: m[1],
      description: m[2].replace(/_/g, ' ').slice(0, 200),
      file: path.join(migDir, name),
    });
  }
  return files;
}

/** @param {import('../oracle/db.js').Tx} tx */
async function appliedVersions(tx) {
  const rows = await tx.many('SELECT VERSION, CHECKSUM FROM SCHEMA_VERSION');
  return new Map(rows.map((r) => [r.VERSION, r.CHECKSUM]));
}

/**
 * Work out what would run.
 * @param {import('../oracle/db.js').Db} db
 * @param {string} dbDir
 */
export async function planMigrations(db, dbDir) {
  const all = await listMigrations(dbDir);
  const applied = await db.read(appliedVersions);
  const pending = [];
  const changed = [];
  for (const m of all) {
    const text = await readFile(m.file, 'utf8');
    const sum = checksum(text);
    if (!applied.has(m.version)) pending.push({ ...m, text, checksum: sum });
    else if (applied.get(m.version) && applied.get(m.version) !== sum) changed.push(m.version);
  }
  return { pending, changed, applied: [...applied.keys()].sort() };
}

/**
 * @param {import('../oracle/db.js').Db} db
 * @param {{ dbDir: string, log?: (msg: string) => void, baselineTo?: string, dryRun?: boolean }} opts
 *   baselineTo: record versions ≤ this as applied WITHOUT running them (they were run by hand
 *   with SQL*Plus before the runner existed).
 */
export async function runMigrations(db, { dbDir, log = () => {}, baselineTo, dryRun = false }) {
  const user = await db.read((tx) => tx.one('SELECT USER AS U FROM DUAL'));
  if (['SYS', 'SYSTEM'].includes(user.U)) {
    throw new Error('Refusing to run migrations as SYS/SYSTEM. Connect as the schema owner.');
  }

  const { pending, changed } = await planMigrations(db, dbDir);
  if (changed.length) {
    log(`WARNING: applied migrations changed on disk since they ran: ${changed.join(', ')}`);
  }
  if (!pending.length) {
    log('Nothing to migrate.');
    return { applied: [], baselined: [] };
  }

  const done = { applied: [], baselined: [] };
  for (const m of pending) {
    if (baselineTo && m.version <= baselineTo) {
      log(`baseline ${m.version} ${m.description} (recorded, not executed)`);
      if (!dryRun) await record(db, m, `${m.description} [baseline]`);
      done.baselined.push(m.version);
      continue;
    }
    const statements = splitSqlScript(m.text);
    log(`apply ${m.version} ${m.description}: ${statements.length} statements`);
    if (dryRun) {
      done.applied.push(m.version);
      continue;
    }
    for (const st of statements) {
      try {
        await db.withTx((tx) => tx.execute(st.sql), {
          usrid: 'migrate',
          action: `mig ${m.version}`,
        });
      } catch (err) {
        if (ALREADY_EXISTS_ERRORS.has(err?.errorNum)) {
          log(
            `  line ${st.line}: ORA-${String(err.errorNum).padStart(5, '0')} (already exists) ignored`,
          );
          continue;
        }
        throw new Error(
          `Migration ${m.version} failed at line ${st.line}: ${err.message}\n${st.sql.slice(0, 400)}`,
          { cause: err },
        );
      }
    }
    await record(db, m, m.description);
    done.applied.push(m.version);
  }
  return done;
}

async function record(db, m, description) {
  await db.withTx(
    (tx) =>
      tx.exec(`INSERT INTO SCHEMA_VERSION (VERSION, DESCRIPTION, CHECKSUM) VALUES (:v, :d, :c)`, {
        v: m.version,
        d: description.slice(0, 200),
        c: m.checksum,
      }),
    { usrid: 'migrate', action: 'record' },
  );
}
