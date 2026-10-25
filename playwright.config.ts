import { defineConfig } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testKey =
  process.env.TEST_ANALYTICS_ADMIN_KEY ?? randomBytes(32).toString('hex')
process.env.TEST_ANALYTICS_ADMIN_KEY = testKey
const testDirectory = mkdtempSync(join(tmpdir(), 'draft-analytics-e2e-'))

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    browserName: 'chromium',
    headless: true,
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5174',
    url: 'http://127.0.0.1:5174/api/analytics/health',
    reuseExistingServer: false,
    env: {
      ANALYTICS_ADMIN_KEY: testKey,
      ANALYTICS_DB_PATH: join(testDirectory, 'events.sqlite'),
      ROOMS_DB_PATH: join(testDirectory, 'rooms.sqlite'),
      ROOMS_TEST_FAST_PRESENTATIONS: 'true',
    },
  },
})
