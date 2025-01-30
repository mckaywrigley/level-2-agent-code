/*
<ai_context>
This file configures Playwright, a powerful end-to-end testing framework.
It defines how our tests will run, what browsers to use, and various testing behaviors.
</ai_context>
*/

import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  // Specify where our end-to-end tests are located
  testDir: "__tests__/e2e",

  // Run all tests in parallel for faster execution
  fullyParallel: true,

  // In CI environments, prevent use of .only() in tests
  // .only() is used during development to run specific tests
  forbidOnly: !!process.env.CI,

  // Number of times to retry failed tests
  // More retries in CI environment to handle flaky tests
  retries: process.env.CI ? 2 : 0,

  // Number of concurrent test workers
  // Limited to 1 in CI to prevent resource conflicts
  workers: process.env.CI ? 1 : undefined,

  // Configure test reporting
  reporter: [
    // 'dot' shows simple dots for test progress
    ["dot"],
    // 'json' creates a detailed JSON report in the specified location
    ["json", { outputFile: "reports/playwright/report.json" }]
  ],

  // Global test configuration
  use: {
    // Base URL for all tests - useful for relative paths in navigation
    baseURL: "http://localhost:3000",
    // Only capture trace (video, screenshots, etc.) on first retry of failed tests
    trace: "on-first-retry"
  },

  // Configure different browsers for testing
  projects: [
    {
      name: "chromium", // Chrome/Edge testing
      use: { ...devices["Desktop Chrome"] }, // Use Chrome-specific settings
      outputDir: "reports/playwright/chromium" // Where to store test artifacts
    },
    {
      name: "firefox", // Firefox testing
      use: { ...devices["Desktop Firefox"] },
      outputDir: "reports/playwright/firefox"
    },
    {
      name: "webkit", // Safari testing
      use: { ...devices["Desktop Safari"] },
      outputDir: "reports/playwright/webkit"
    }
  ]
})
