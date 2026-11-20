import { defineConfig } from 'vitest/config';

// Unit tests only; Playwright e2e specs live in e2e/ and run with `pnpm test:e2e`.
export default defineConfig({
  test: { include: ['src/**/*.test.{js,jsx}'], passWithNoTests: true },
});
