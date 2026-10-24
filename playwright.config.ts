import { defineConfig, devices } from '@playwright/test';

const PORT = 4321;
const FIXTURE_PORT = 4323;

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', testIgnore: /fixture\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    // Site built from edited content (see tests/e2e/build-fixture.mjs).
    {
      name: 'fixture',
      testMatch: /fixture\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${FIXTURE_PORT}` },
    },
  ],
  webServer: [
    // Serves the production build under /CesartPortfolio/. Run `npm run build` first.
    {
      command: `npm run preview -- --port ${PORT}`,
      url: `http://localhost:${PORT}/CesartPortfolio/`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `node tests/e2e/build-fixture.mjs && node node_modules/astro/bin/astro.mjs preview --root .e2e-fixture --port ${FIXTURE_PORT}`,
      url: `http://localhost:${FIXTURE_PORT}/CesartPortfolio/`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
