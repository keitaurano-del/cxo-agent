import { defineConfig } from '@playwright/test';

// スモーク専用 config。生死確認に特化し、workers=1 / timeout 短めで速く回す。
export default defineConfig({
  testDir: './e2e',
  testMatch: /render-smoke-.*\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  timeout: 20_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4317',
    actionTimeout: 8_000,
    navigationTimeout: 12_000,
  },
});
