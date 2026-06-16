import { defineConfig, devices } from '@playwright/test';

/**
 * E2E + visual-regression lane (plan 046, Iteration 8). Separate from `npm test` (Vitest, headless
 * node units) — it boots the real Vite app + the static asset server and drives a browser. Targets
 * the self-contained object-viewer, whose models live in the committed `static/viewer/` (no 700 MB
 * WIMG archive needed). Headless Chromium renders WebGL via SwiftShader, so canvas screenshots are
 * deterministic across machines.
 */
const APP_PORT = 5173;
const STATIC_PORT = 3001;

export default defineConfig({
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  forbidOnly: !!process.env.CI,
  fullyParallel: true,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  reporter: 'list',
  retries: process.env.CI ? 2 : 0,
  testDir: './e2e',
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'npm run serve:static',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      url: `http://localhost:${STATIC_PORT}/viewer/objects/wattspark1_lae2.dff`,
    },
    {
      command: `npm run dev -- --port ${APP_PORT} --strictPort`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: `http://localhost:${APP_PORT}`,
    },
  ],
  workers: process.env.CI ? 1 : undefined,
});
