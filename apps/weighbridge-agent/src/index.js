// Weighbridge agent entry point (TASKS P3-02). Runs on the weighbridge PC as a Windows service /
// start-up task (scripts/install-task.ps1). See README.md.
import pino from 'pino';
import { Agent } from './agent.js';
import { ApiClient } from './api-client.js';
import { loadLocalConfig, readSettings } from './config.js';
import { AgentStore } from './store.js';
import { startWsServer } from './ws-server.js';

const local = loadLocalConfig();
const log = pino(
  {
    name: 'weighbridge-agent',
    redact: ['secret', '*.secret', 'signature', '*.signature', 'token'],
  },
  local.logFile ? pino.destination({ dest: local.logFile, mkdir: true }) : undefined,
);
const store = new AgentStore(local.storePath);
const api = new ApiClient({ apiUrl: local.apiUrl, deviceId: local.deviceId, secret: local.secret });

// device configuration from Admin › Devices; the cached copy when the API is not reachable
let serverConfig = null;
try {
  const me = await api.me();
  serverConfig = me.config ?? {};
  store.set('deviceConfig', serverConfig);
  log.info({ deviceId: me.deviceId, brnch: me.brnch }, 'signed in to the API');
} catch (e) {
  serverConfig = store.get('deviceConfig');
  log.warn({ err: e.message, cached: !!serverConfig }, 'API not reachable at start-up');
}
const settings = readSettings(serverConfig, local);

const agent = new Agent(
  { deviceId: local.deviceId, secret: local.secret, retryMs: local.retryMs, ...settings },
  { api, store, log },
);
agent.start();
const wss = await startWsServer(agent, {
  port: local.wsPort,
  allowedOrigins: local.allowedOrigins,
  allowNoOrigin: local.allowNoOrigin,
  log,
});
log.info({ source: agent.source.name }, 'agent running');
setInterval(() => store.purge(30), 24 * 3600 * 1000).unref();

const shutdown = () => {
  log.info('stopping');
  agent.stop();
  wss.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
