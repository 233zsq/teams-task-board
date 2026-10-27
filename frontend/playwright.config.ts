import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5174', viewport: { width: 1366, height: 1000 },
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5174', url: 'http://127.0.0.1:5174', reuseExistingServer: false,
    env: { API_PROXY_TARGET: 'http://127.0.0.1:3101' }, timeout: 30_000,
  },
});
