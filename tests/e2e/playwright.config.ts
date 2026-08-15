import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  use: {
    baseURL: process.env.BASE_URL ?? "http://gadget-host:8080",
    browserName: "chromium",
  },
  reporter: "line",
});
