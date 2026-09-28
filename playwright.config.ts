import { defineConfig, devices } from "@playwright/test";

/*
 * Specs that change instance-wide state no workspace can scope. The
 * legal-acceptance spec publishes the active terms, which every other user
 * must accept before any workspace request succeeds, so it must never run
 * beside another spec (REL-057). Each browser project names an `-exclusive`
 * project as its teardown, and Playwright starts that project only after every
 * test of the browser project has finished, still starts it after a parallel
 * failure, and adds it to every run that selects the browser project. The
 * browser project still matches these specs, which skip themselves there, so
 * `--project=chromium <spec>` keeps selecting them.
 */
const exclusiveSpecs = /legal-acceptance\.GOVERNANCE-001\.spec\.ts$/;

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
      teardown: "chromium-exclusive",
    },
    {
      name: "chromium-exclusive",
      use: { ...devices["Desktop Chrome"] },
      testMatch: exclusiveSpecs,
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      teardown: "firefox-exclusive",
    },
    {
      name: "firefox-exclusive",
      use: { ...devices["Desktop Firefox"] },
      testMatch: exclusiveSpecs,
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      teardown: "webkit-exclusive",
    },
    {
      name: "webkit-exclusive",
      use: { ...devices["Desktop Safari"] },
      testMatch: exclusiveSpecs,
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
