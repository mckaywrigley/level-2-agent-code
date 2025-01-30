/*
<ai_context>
This file contains the configuration for Jest.
</ai_context>
*/

import type { Config } from "jest"
import nextJest from "next/jest.js"

const createJestConfig = nextJest({
  dir: "./"
})

const config: Config = {
  coverageProvider: "v8",
  testEnvironment: "jsdom",
  testMatch: [
    "<rootDir>/__tests__/unit/**/*.test.ts",
    "<rootDir>/__tests__/unit/**/*.test.tsx"
  ]
}

export default createJestConfig(config)
