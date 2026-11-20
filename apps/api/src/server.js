// API process entry point.
import { loadConfig } from './config.js';
import { createDb } from './lib/oracle/db.js';
import { buildApp } from './app.js';

const config = loadConfig();
const db = await createDb(config);
const app = await buildApp({ config, db });

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    await db.close(10);
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

await app.listen({ port: config.API_PORT, host: config.API_HOST });
