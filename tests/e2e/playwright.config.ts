import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://gadget-host:8080',
    browserName: 'chromium',
    launchOptions: {
      args: ['--unsafely-treat-insecure-origin-as-secure=http://gadget-host:8080'],
    },
  },
  reporter: 'line',
});
