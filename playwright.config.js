// @ts-check
const { defineConfig, devices } = require("@playwright/test");

/**
 * E2E config for the visual-editing work.
 *
 * Two servers come up together:
 *  - static-server on 8080 serving a finished `npm run build` of _site/
 *  - decap-server on 8082, Decap's local git proxy
 *
 * The proxy is what makes the CMS testable at all: with `local_backend` in
 * src/admin/config.yml, Decap talks to it instead of GitHub OAuth, so the real
 * admin UI can be driven headlessly. Port 8082 avoids decap-server's default
 * 8081, which `npm run dev` already uses for Eleventy.
 */
module.exports = defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // CMS tests commit to the working tree; keep them serial
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      command: "npm run build && node scripts/static-server.js 8080",
      url: "http://localhost:8080/",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "pipe",
    },
    {
      command: "npx decap-server",
      env: { PORT: "8082" },
      // Wait on the TCP port, not a URL: the proxy only answers POST /api/v1 and
      // returns 404 to the GET that Playwright's url check would issue.
      port: 8082,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
    },
  ],
});
