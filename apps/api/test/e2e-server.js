// Sandbox API for browser (Playwright) tests: the real app on ONE Oracle connection whose
// transaction is never committed. Requests are serialised (a mutex around every unit of work) so
// savepoints of parallel browser requests cannot undo each other. A test user is created inside
// the sandbox; when the process stops, everything is rolled back (rollback-only rule, 19 Nov 2026).
//
//   node --env-file=../../.env test/e2e-server.js        (listens on API_PORT, default 4000)
//
// Never point this at production: it refuses NODE_ENV=production.
import { AsyncLocalStorage } from 'node:async_hooks';
import oracledb from 'oracledb';
import { buildApp } from '../src/app.js';
import { initOracleClient } from '../src/lib/oracle/db.js';
import { SavepointDb, createUser } from './helpers/app.js';
import { testConfig } from './helpers/db.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to start the sandbox server in production');
  process.exit(2);
}

class SerialDb extends SavepointDb {
  constructor(conn) {
    super(conn);
    this.chain = Promise.resolve();
    this.inside = new AsyncLocalStorage();
  }

  withTx(fn, ctx) {
    // a unit of work started from inside another runs inline (queueing it would deadlock)
    if (this.inside.getStore()) return super.withTx(fn, ctx);
    const run = this.chain.then(() => this.inside.run(true, () => super.withTx(fn, ctx)));
    this.chain = run.catch(() => {});
    return run;
  }

  read(fn, ctx = {}) {
    return this.withTx(fn, { ...ctx, rollback: true });
  }
}

const config = { ...testConfig(), LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'warn' };
initOracleClient(config);
const conn = await oracledb.getConnection({
  user: config.DATABASE_USER,
  password: config.DATABASE_PASSWORD,
  connectString: config.DATABASE_CONNECT_STRING,
});
const db = new SerialDb(conn);

const usrid = process.env.E2E_USER ?? 'E2E_ADMIN';
const password = process.env.E2E_PASSWORD ?? 'E2e-Sandbox-Passw0rd';
await createUser(db, {
  usrid,
  password,
  roles: {
    1: ['SYS_ADMIN', 'FINANCE_MANAGER', 'AUDITOR', 'MARKETING'],
    2: ['SYS_ADMIN', 'FINANCE_MANAGER', 'AUDITOR', 'MARKETING'],
  },
});

const app = await buildApp({ config, db });
async function stop() {
  await app.close().catch(() => {});
  await conn.rollback().catch(() => {});
  await conn.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('message', (m) => m === 'shutdown' && stop());

await app.listen({ port: Number(process.env.API_PORT ?? 4000), host: '127.0.0.1' });
console.log(`sandbox API ready (nothing is committed); test user ${usrid}`);
