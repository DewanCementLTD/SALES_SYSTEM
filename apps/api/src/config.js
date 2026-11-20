// Runtime configuration from environment variables (documented in .env.example).
// Validated once at start-up; the app refuses to start with a bad configuration.
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'Y', 'N'])
  .transform((v) => v === 'true' || v === '1' || v === 'Y');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_USER: z.string().min(1),
  DATABASE_PASSWORD: z.string().min(1),
  DATABASE_CONNECT_STRING: z.string().min(1),
  ORACLE_CLIENT_MODE: z.enum(['thick', 'thin']).default('thick'),
  ORACLE_LIB_DIR: z.string().optional(),
  DB_POOL_MIN: z.coerce.number().int().min(0).default(4),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(30),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  QR_SECRET: z.string().min(16, 'QR_SECRET must be at least 16 characters'),
  APP_ENC_KEY: z
    .string()
    .refine((s) => Buffer.from(s, 'base64').length === 32, 'APP_ENC_KEY must be 32 bytes, base64'),
  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  WEB_ORIGIN: z.string().url().default('http://localhost:3200'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3200'),
  COOKIE_SECURE: bool.default('false'),
  STORAGE_DIR: z.string().default('./storage'),
});

/** @typedef {z.infer<typeof schema>} AppConfig */

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {AppConfig}
 */
export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

/** Test configuration: TEST_DB_* override DATABASE_*; secrets get safe defaults. */
export function loadTestConfig(env = process.env) {
  return loadConfig({
    JWT_SECRET: 'test-jwt-secret-test-jwt-secret-0001',
    QR_SECRET: 'test-qr-secret-0001',
    APP_ENC_KEY: Buffer.alloc(32, 7).toString('base64'),
    ...env,
    NODE_ENV: 'test',
    LOG_LEVEL: env.TEST_LOG_LEVEL ?? 'silent',
    DATABASE_USER: env.TEST_DB_USER ?? env.DATABASE_USER,
    DATABASE_PASSWORD: env.TEST_DB_PASSWORD ?? env.DATABASE_PASSWORD,
    DATABASE_CONNECT_STRING: env.TEST_DB_CONNECT_STRING ?? env.DATABASE_CONNECT_STRING,
    DB_POOL_MIN: '0',
    DB_POOL_MAX: env.TEST_DB_POOL_MAX ?? '60',
  });
}
