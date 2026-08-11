import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.CADRIA_E2E_URL ?? 'http://127.0.0.1:3080',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
