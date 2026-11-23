// Agent configuration. The local file (agent.config.json, path in AGENT_CONFIG) holds only what
// the agent needs to reach the API and serve the screen; the device secret comes from
// DEVICE_SECRET or `secretFile` (never in logs). How to read the indicator (source, parser
// profile, stable rule) is managed centrally in Admin › Devices (config JSON) and cached locally
// for start-ups while the API is down.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const zSource = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('simulator'),
    intervalMs: z.number().int().min(50).optional(),
    loadKg: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('tcp'),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  }),
  z.object({
    type: z.literal('serial'),
    path: z.string().min(1),
    baudRate: z.number().int().default(9600),
    dataBits: z.union([z.literal(7), z.literal(8)]).default(8),
    parity: z.enum(['none', 'even', 'odd']).default('none'),
    stopBits: z.union([z.literal(1), z.literal(2)]).default(1),
  }),
]);
const zParser = z.union([
  z.string(),
  z.object({
    regex: z.string().min(3),
    motion: z.array(z.string()).optional(),
    error: z.array(z.string()).optional(),
    unit: z.enum(['kg', 't']).optional(),
  }),
]);

/** Indicator settings (device config from Admin › Devices). */
export const zReadSettings = z.object({
  source: zSource,
  parser: zParser.default('st-gs'),
  stable: z
    .object({ count: z.number().int().min(2).max(50), kg: z.number().min(0).max(1000) })
    .partial()
    .optional(),
  offlineMs: z.number().int().min(500).max(60000).default(3000),
});

const zLocal = z.object({
  apiUrl: z.string().url(),
  deviceId: z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,39}$/),
  secretFile: z.string().optional(),
  wsPort: z.number().int().default(7071),
  allowedOrigins: z.array(z.string()).default([]),
  allowNoOrigin: z.boolean().default(false),
  storePath: z.string().default('agent-store.sqlite'),
  logFile: z.string().optional(),
  retryMs: z.number().int().min(1000).default(10000),
  // bench / first install only: used when the server has no source configured yet
  source: zSource.optional(),
  parser: zParser.optional(),
});

/** Read the local file and the secret. */
export function loadLocalConfig(env = process.env) {
  const file = resolve(env.AGENT_CONFIG ?? 'agent.config.json');
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const local = zLocal.parse(raw);
  const base = dirname(file);
  const secret =
    env.DEVICE_SECRET ??
    (local.secretFile ? readFileSync(resolve(base, local.secretFile), 'utf8').trim() : '');
  if (!secret) throw new Error('Device secret missing: set DEVICE_SECRET or secretFile');
  return { ...local, storePath: resolve(base, local.storePath), secret };
}

/**
 * Effective indicator settings: device config from the server (or its cached copy) wins; the
 * local file's source/parser only fill in when the server has none.
 */
export function readSettings(serverConfig, local) {
  const c = serverConfig ?? {};
  return zReadSettings.parse({
    source: c.source ?? local.source,
    parser: c.parser ?? c.profile ?? local.parser ?? 'st-gs',
    stable: c.stable,
    offlineMs: c.offlineMs,
  });
}
