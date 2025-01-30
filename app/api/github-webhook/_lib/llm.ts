/*
<ai_context>
This file contains the logic for selecting and configuring the LLM (Large Language Model) provider.
It supports both OpenAI and Anthropic's Claude models, with configuration determined by environment variables.
</ai_context>
*/

import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"

/**
 * Creates and returns a configured LLM client based on environment settings.
 * This function handles the logic of choosing between different AI providers
 * and configuring them with the appropriate API keys and models.
 *
 * @returns A configured LLM client (either OpenAI or Anthropic)
 * @throws Error if required API keys are missing
 */
export function getLLMModel() {
  // Get the provider from environment variables, defaulting to OpenAI if not specified
  const provider = process.env.LLM_PROVIDER || "openai"

  // Default model names for each provider
  // These are used if no specific model is specified in environment variables
  const openAIDefaultModel = "o1"
  const anthropicDefaultModel = "claude-3-5-sonnet-latest"

  // Handle Anthropic configuration
  if (provider === "anthropic") {
    // Check for required API key
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("Missing ANTHROPIC_API_KEY for Anthropic usage.")
    }

    // Create and configure the Anthropic client
    const anthropic = createAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    })

    // Return the configured model, using the default if none specified
    return anthropic(process.env.LLM_MODEL || anthropicDefaultModel)
  }

  // Handle OpenAI configuration (default case)
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY for OpenAI usage.")
  }

  // Create and configure the OpenAI client
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    compatibility: "strict" // Ensures strict API compatibility mode
  })

  // Return the configured model, using the default if none specified
  return openai(process.env.LLM_MODEL || openAIDefaultModel)
}
