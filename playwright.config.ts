/*
<ai_context>
This file contains the configuration for Playwright.
</ai_context>
*/

import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "__tests__/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["dot"],
    ["json", { outputFile: "reports/playwright/report.json" }]
  ],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      outputDir: "reports/playwright/chromium"
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      outputDir: "reports/playwright/firefox"
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      outputDir: "reports/playwright/webkit"
    }
  ]
})
