import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

// unit: no database. integration (*.int.test.js): real Oracle (TEST_DB_*), every test rolls back.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.js', 'test/**/*.test.js'],
          exclude: ['**/*.int.test.js', '**/node_modules/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.int.test.js', 'test/**/*.int.test.js'],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          fileParallelism: false,
          // node-oracledb Thick mode loads a native client once per process
          pool: 'forks',
        },
      },
    ],
  },
});
