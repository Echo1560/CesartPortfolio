import { defineConfig, devices } from '@playwright/test';

const PORT = 4321;
const FIXTURE_PORT = 4323;
const ADMIN_PORT = 4324;
const ADMIN_API = 'http://127.0.0.1:54399'; // answered by tests/e2e/admin-mock.ts, never a real backend

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
    { name: 'chromium', testIgnore: /(fixture|admin-.*)\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    // Site built from edited content (see tests/e2e/build-fixture.mjs).
    {
      name: 'fixture',
      testMatch: /fixture\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${FIXTURE_PORT}` },
    },
    // Dashboard specs: the admin bundle is built against ADMIN_API and Supabase is mocked in the browser.
    {
      name: 'admin',
      testMatch: /admin-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${ADMIN_PORT}` },
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
    {
      command: `node node_modules/astro/bin/astro.mjs build --outDir .e2e-admin/dist && node tests/e2e/serve-static.mjs .e2e-admin/dist ${ADMIN_PORT}`,
      url: `http://localhost:${ADMIN_PORT}/CesartPortfolio/admin/`,
      env: { PUBLIC_SUPABASE_URL: ADMIN_API, PUBLIC_SUPABASE_ANON_KEY: 'e2e-anon-key' },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
