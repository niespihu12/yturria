import { defineConfig, devices } from '@playwright/test'

const BACKEND_PORT = process.env.E2E_BACKEND_PORT ?? '8002'
const FRONTEND_PORT = process.env.E2E_FRONTEND_PORT ?? '5174'
const isCI = !!process.env.CI

// E2E contra un backend real con SQLite desechable (ver e2e/start-backend.mjs):
// nunca toca la base de datos ni las claves de producción.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      // Localmente usa el Chrome instalado; en CI el Chromium de Playwright.
      use: { ...devices['Desktop Chrome'], channel: isCI ? undefined : 'chrome' },
    },
  ],
  webServer: [
    {
      command: 'node e2e/start-backend.mjs',
      url: `http://127.0.0.1:${BACKEND_PORT}/health`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      env: { E2E_BACKEND_PORT: BACKEND_PORT, E2E_FRONTEND_PORT: FRONTEND_PORT },
    },
    {
      command: `npm run dev -- --port ${FRONTEND_PORT} --strictPort`,
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      env: { VITE_API_URL: `http://localhost:${BACKEND_PORT}/api` },
    },
  ],
})
