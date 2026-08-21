import { defineConfig, devices } from '@playwright/test'

const testPort = process.env.PLAYWRIGHT_PORT || '5173'
const isolated = process.env.PLAYWRIGHT_ISOLATED === '1'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 1,
  reporter: 'html',
  use: { baseURL: `http://127.0.0.1:${testPort}`, trace: 'on-first-retry' },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${testPort}`,
    url: `http://127.0.0.1:${testPort}`,
    reuseExistingServer: !isolated,
  },
  projects: [
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
    { name: 'tablet', use: { ...devices['iPad Pro 11'] } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
})
