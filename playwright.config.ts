import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration.
 *
 * Projects:
 *   extension  - tests/e2e: launches a persistent Chromium context with the
 *                built extension (dist/) loaded. Extensions only work in
 *                Chromium with a persistent context, so the tests create their
 *                own context instead of using the `page` fixture. Run
 *                `npm run build` first; the suite skips itself when dist/ is
 *                missing.
 *   ci-parity  - ci/example.spec.ts: the CI parity example (axe with the shared
 *                rule configuration + baseline). It skips itself unless
 *                A11Y_URL is set.
 *
 * Environment variables:
 *   A11Y_E2E_HEADED=1   run the extension suite with a visible browser window
 *   A11Y_E2E_DIST=path  load a different build directory (default: ./dist)
 *   A11Y_URL, A11Y_BASELINE, A11Y_LEVEL, A11Y_BEST_PRACTICES  see ci/example.spec.ts
 */
export default defineConfig({
  timeout: 150_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "test-results/playwright-report" }]] : [["list"]],
  outputDir: "test-results/e2e",
  use: {
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "extension", testDir: "./tests/e2e", testMatch: "**/*.spec.ts" },
    { name: "ci-parity", testDir: "./ci", testMatch: "**/*.spec.ts" },
    // Monkey test: skips itself unless started with `npm run test:monkey` (MONKEY_RUN=1).
    { name: "monkey", testDir: "./tests/monkey", testMatch: "**/*.spec.ts" },
  ],
});
