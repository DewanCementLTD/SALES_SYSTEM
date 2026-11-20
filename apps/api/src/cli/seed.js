// pnpm db:seed [--dry-run]
// Inserts missing roles, permissions, settings, approval rules, numbering rows and the first admin.
import { systemClock } from '@dcl/shared';
import { loadConfig } from '../config.js';
import { createDb } from '../lib/oracle/db.js';
import { seedAll } from '../seed/index.js';

const dryRun = process.argv.includes('--dry-run');
const cfg = loadConfig();
const db = await createDb({ ...cfg, DB_POOL_MIN: 0, DB_POOL_MAX: 2 });
try {
  const res = await db.withTx((tx) => seedAll(tx, { clock: systemClock }), {
    usrid: 'seed',
    action: 'seed',
    rollback: dryRun,
  });
  console.log(`${dryRun ? '[dry run, rolled back] ' : ''}fiscal year ${res.year}`);
  console.log(`permissions created: ${res.permissions}`);
  console.log(`roles created: ${res.roles.roles}, role grants created: ${res.roles.grants}`);
  console.log(`settings created: ${res.settings}`);
  console.log(`approval rules created: ${res.approvalRules}`);
  console.log('numbering (DOC_SEQUENCE):');
  for (const n of res.numbering) {
    console.log(
      `  ${n.brnch} ${n.docType.padEnd(4)} last_no=${n.lastNo}${n.created ? ' (new)' : ''}`,
    );
  }
  if (res.admin) {
    console.log('\nFirst administrator created. Shown ONCE; must be changed at first login:');
    console.log(`  user: ${res.admin.usrid}\n  password: ${res.admin.password}`);
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await db.close(0);
}
