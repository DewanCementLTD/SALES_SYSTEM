// Playwright e2e: starts the sandbox API (nothing committed, see apps/api/test/e2e-server.js)
// and the built web app (`pnpm --filter @dcl/web build` first).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const E2E_USER = process.env.E2E_USER ?? 'E2E_ADMIN';
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'E2e-Sandbox-Passw0rd';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '3210';
const API_PORT = process.env.E2E_API_PORT ?? '4010';
process.env.E2E_USER = E2E_USER;
process.env.E2E_PASSWORD = E2E_PASSWORD;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // the sandbox API serialises everything on one connection
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
    timezoneId: 'Asia/Karachi',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command: 'node --env-file-if-exists=../../.env test/e2e-server.js',
      cwd: fileURLToPath(new URL('../api', import.meta.url)),
      url: `http://127.0.0.1:${API_PORT}/health/live`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { E2E_USER, E2E_PASSWORD, API_PORT },
    },
    {
      // own ports so e2e never talks to a running dev server (3000/3100 are used by other apps here)
      command: `npx next start --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_URL: `http://127.0.0.1:${API_PORT}`, NODE_ENV: 'production' },
    },
  ],
});
