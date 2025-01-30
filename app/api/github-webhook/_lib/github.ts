/*
<ai_context>
This file contains core functions for interacting with GitHub's API.
It sets up authentication and provides utility functions for accessing repository content.
</ai_context>
*/

import { createAppAuth } from "@octokit/auth-app"
import { Octokit } from "@octokit/rest"
import { Buffer } from "buffer"

// Required environment variables for GitHub App authentication
const { GH_APP_ID, GH_PRIVATE_KEY, GH_INSTALLATION_ID } = process.env

// Validate that all required environment variables are present
// This check runs when the application starts up
if (!GH_APP_ID || !GH_PRIVATE_KEY || !GH_INSTALLATION_ID) {
  throw new Error(
    "Missing GitHub App environment variables: GH_APP_ID, GH_PRIVATE_KEY, GH_INSTALLATION_ID."
  )
}

// Create an authenticated Octokit instance
// Octokit is GitHub's official client library for interacting with their API
export const octokit = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    appId: GH_APP_ID, // The ID of your GitHub App
    privateKey: GH_PRIVATE_KEY, // The private key for authentication
    installationId: GH_INSTALLATION_ID // The installation ID for this specific repo
  }
})

/**
 * Retrieves the content of a specific file from a GitHub repository.
 *
 * @param owner - The GitHub username or organization that owns the repository
 * @param repo - The name of the repository
 * @param path - The path to the file within the repository
 * @param ref - The git reference (branch name, commit SHA, etc.) to fetch from
 * @returns The file content as a UTF-8 string, or undefined if the file doesn't exist
 */
export async function getFileContent(
  owner: string,
  repo: string,
  path: string,
  ref: string
) {
  try {
    // Fetch the file content from GitHub
    // GitHub returns file content as base64-encoded string
    const response = await octokit.repos.getContent({ owner, repo, path, ref })

    // Check if we received file content (could also be directory content)
    if (
      "content" in response.data &&
      typeof response.data.content === "string"
    ) {
      // Convert the base64-encoded content back to a UTF-8 string
      return Buffer.from(response.data.content, "base64").toString("utf8")
    }
    return undefined
  } catch (err: any) {
    // Handle the case where the file doesn't exist (404 error)
    if (err.status === 404) {
      console.log(`File ${path} not found at ref ${ref}`)
      return undefined
    }
    // Re-throw any other errors
    throw err
  }
}
