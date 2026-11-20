// pnpm db:migrate [--dry-run] [--baseline=NNN]
// Applies pending migrations as the schema owner (DATABASE_* from .env).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { createDb } from '../lib/oracle/db.js';
import { runMigrations } from '../lib/migrate/runner.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const baselineArg = args.find((a) => a.startsWith('--baseline='));
const baselineTo = baselineArg ? baselineArg.split('=')[1] : undefined;
if (baselineTo && !/^\d{2,3}$/.test(baselineTo)) {
  console.error('--baseline must be a migration number, e.g. --baseline=002');
  process.exit(2);
}

const dbDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../db');

const cfg = loadConfig();
const db = await createDb({ ...cfg, DB_POOL_MIN: 0, DB_POOL_MAX: 2 });
try {
  const res = await runMigrations(db, { dbDir, dryRun, baselineTo, log: (m) => console.log(m) });
  console.log(
    `${dryRun ? '[dry run] ' : ''}applied: ${res.applied.join(', ') || '-'}; baselined: ${res.baselined.join(', ') || '-'}`,
  );
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await db.close(0);
}
