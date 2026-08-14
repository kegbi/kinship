import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 3,
  reporter: "line",
  outputDir: ".artifacts/playwright",
  use: {
    baseURL: process.env.TEST_WEB_ORIGIN ?? "http://127.0.0.1:4321",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: process.env.E2E_EXTERNAL_WEB === "1" ? undefined : {
    command: "deno task dev:web",
    env: {
      API_ORIGIN: process.env.API_ORIGIN ?? "http://127.0.0.1:8000",
      WEB_PORT: process.env.WEB_PORT ?? "4321",
    },
    url: process.env.TEST_WEB_ORIGIN ?? "http://127.0.0.1:4321",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
