import { defineConfig, devices } from '@playwright/test'

const dataDirectory = process.env.SCPO_E2E_DATA_DIR
if (!dataDirectory) {
  throw new Error('Execute os testes E2E por `npm run test:e2e` para usar bancos temporários isolados.')
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'bash scripts/dev-api.sh',
      url: 'http://127.0.0.1:8001/health',
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        SCPO_ENV: 'development',
        SCPO_LOCAL_DATA_DIR: dataDirectory,
        SCPO_COOKIE_SECURE: 'false',
      },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --strictPort',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
