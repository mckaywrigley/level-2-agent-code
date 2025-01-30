/*
<ai_context>
This file contains the configuration for Jest.
</ai_context>
*/

// Import the Jest Config type for TypeScript type checking
import type { Config } from "jest"
// Import the Next.js Jest configuration helper
import nextJest from "next/jest.js"

// Create a Jest configuration function specifically for Next.js
// This adds Next.js-specific configuration automatically
const createJestConfig = nextJest({ dir: "./" }) // './' specifies the root directory of the project

// Define the Jest configuration object
const config: Config = {
  // Specify which coverage provider to use
  // 'v8' is the newer, faster coverage provider built into Node.js
  coverageProvider: "v8",

  // Specify where to output coverage reports
  coverageDirectory: "reports/jest/coverage",

  // Set the testing environment
  // 'jsdom' provides a browser-like environment for testing DOM operations
  testEnvironment: "jsdom",

  // Configure module name mapping
  // This allows us to use '@/' imports in our tests just like in our source code
  // For example, '@/components' will resolve to '<rootDir>/components'
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1"
  },

  // Configure test reporters
  // Reporters determine how test results are presented
  reporters: [
    "default", // Use the default Jest reporter
    [
      "jest-junit", // Also use Jest JUnit reporter for CI/CD integration
      {
        outputDirectory: "reports/jest", // Where to save the JUnit XML report
        outputName: "test-results.xml" // Name of the output file
      }
    ]
  ],

  // Specify which files should be treated as tests
  // This configuration looks for .test.ts and .test.tsx files in the __tests__/unit directory
  testMatch: [
    "<rootDir>/__tests__/unit/**/*.test.ts",
    "<rootDir>/__tests__/unit/**/*.test.tsx"
  ]
}

// Export the configuration wrapped with Next.js specific settings
// This allows Next.js to add its own necessary configuration on top of ours
export default createJestConfig(config)
