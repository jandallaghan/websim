import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 2,
  retries: 0,
  reporter: [["list"]],
  use: { headless: true, trace: "retain-on-failure" },
});
