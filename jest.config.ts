/*
<ai_context>
This file contains the configuration for Jest.
</ai_context>
*/

import type { Config } from "jest"
import nextJest from "next/jest.js"

const createJestConfig = nextJest({ dir: "./" })

const config: Config = {
  coverageProvider: "v8",
  coverageDirectory: "reports/jest/coverage",
  testEnvironment: "jsdom",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1"
  },
  reporters: [
    "default",
    [
      "jest-junit",
      {
        outputDirectory: "reports/jest",
        outputName: "test-results.xml"
      }
    ]
  ],
  testMatch: [
    "<rootDir>/__tests__/unit/**/*.test.ts",
    "<rootDir>/__tests__/unit/**/*.test.tsx"
  ]
}

export default createJestConfig(config)
