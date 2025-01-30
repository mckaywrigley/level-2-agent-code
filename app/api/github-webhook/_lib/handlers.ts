/*
<ai_context>
This file contains functions for handling GitHub webhook events.
It processes pull request data and prepares it for analysis by the AI agents.
</ai_context>
*/

import { getFileContent, octokit } from "./github"

// Size limit for files to be included in the analysis (32KB)
// Files larger than this are excluded to prevent token limit issues with the AI
const SIZE_THRESHOLD = 32000

// List of files that should be excluded from analysis
// These files typically contain auto-generated content or are too large
const EXCLUDE_PATTERNS = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]

/**
 * Checks if a file should be excluded from analysis based on its filename
 *
 * @param filename - The name of the file to check
 * @returns true if the file should be excluded, false otherwise
 */
function shouldExcludeFile(filename: string): boolean {
  return EXCLUDE_PATTERNS.some(pattern => filename.endsWith(pattern))
}

/**
 * Base interface for pull request context
 * Contains all the essential information about a pull request
 * that's needed for analysis
 */
export interface PullRequestContext {
  owner: string // Repository owner (user or organization)
  repo: string // Repository name
  pullNumber: number // Pull request number
  headRef: string // The branch being merged (source)
  baseRef: string // The branch being merged into (target)
  title: string // Pull request title
  changedFiles: {
    // Array of files modified in the PR
    filename: string // Path to the file
    patch: string // Git diff of changes
    status: string // File status (added/modified/removed)
    additions: number // Lines added
    deletions: number // Lines removed
    content?: string // Current file content (if available)
    excluded?: boolean // Whether file was excluded from analysis
  }[]
  commitMessages: string[] // Messages from all commits in the PR
}

/**
 * Extended interface that includes information about existing test files
 * Used specifically by the test generation agent
 */
export interface PullRequestContextWithTests extends PullRequestContext {
  existingTestFiles: {
    // Array of existing test files
    filename: string // Path to the test file
    content: string // Content of the test file
  }[]
}

/**
 * Processes a GitHub webhook payload to extract basic pull request information
 * This is the foundation for both review and test generation
 *
 * @param payload - The raw webhook payload from GitHub
 * @returns A structured PullRequestContext object
 */
export async function handlePullRequestBase(
  payload: any
): Promise<PullRequestContext> {
  // Extract basic information from the payload
  const owner = payload.repository.owner.login
  const repo = payload.repository.name
  const pullNumber = payload.pull_request.number
  const headRef = payload.pull_request.head.ref
  const baseRef = payload.pull_request.base.ref
  const title = payload.pull_request.title

  // Fetch the list of files changed in this PR
  const filesRes = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: pullNumber
  })

  // Process each changed file
  const changedFiles = await Promise.all(
    filesRes.data.map(async file => {
      const fileObj = {
        filename: file.filename,
        patch: file.patch ?? "", // Git diff, if available
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        content: undefined as string | undefined,
        excluded: false
      }

      // Only fetch content for files that:
      // 1. Haven't been deleted
      // 2. Aren't in the exclude list
      if (file.status !== "removed" && !shouldExcludeFile(file.filename)) {
        const fileContent = await getFileContent(
          owner,
          repo,
          file.filename,
          headRef
        )
        // Only include content if it's under the size threshold
        if (fileContent && fileContent.length <= SIZE_THRESHOLD) {
          fileObj.content = fileContent
        } else {
          fileObj.excluded = true
        }
      } else {
        fileObj.excluded = true
      }

      return fileObj
    })
  )

  // Fetch all commit messages from the PR
  const commitsRes = await octokit.pulls.listCommits({
    owner,
    repo,
    pull_number: pullNumber
  })
  const commitMessages = commitsRes.data.map(c => c.commit.message)

  return {
    owner,
    repo,
    pullNumber,
    headRef,
    baseRef,
    title,
    changedFiles,
    commitMessages
  }
}

/**
 * Recursively fetches all test files from a repository
 * This helps the test generation agent understand existing test coverage
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param ref - Git reference (branch/commit) to fetch from
 * @param dirPath - Directory to search (defaults to "__tests__")
 * @returns Array of test files with their content
 */
async function getAllTestFiles(
  owner: string,
  repo: string,
  ref: string,
  dirPath = "__tests__"
): Promise<{ filename: string; content: string }[]> {
  const results: { filename: string; content: string }[] = []

  try {
    // Get contents of the directory
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: dirPath,
      ref
    })

    // Process each item in the directory
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.type === "file") {
          // If it's a file, fetch its content
          const fileContent = await getFileContent(owner, repo, item.path, ref)
          if (fileContent) {
            results.push({
              filename: item.path,
              content: fileContent
            })
          }
        } else if (item.type === "dir") {
          // If it's a directory, recursively fetch its contents
          const subDirFiles = await getAllTestFiles(owner, repo, ref, item.path)
          results.push(...subDirFiles)
        }
      }
    }
  } catch (err: any) {
    if (err.status === 404) {
      console.log(`No ${dirPath} folder found, skipping.`)
    } else {
      console.error("Error in getAllTestFiles:", err)
    }
  }

  return results
}

/**
 * Enhanced version of handlePullRequestBase that also fetches existing test files
 * Used specifically by the test generation agent
 *
 * @param payload - The raw webhook payload from GitHub
 * @returns Extended context including test files
 */
export async function handlePullRequestForTestAgent(
  payload: any
): Promise<PullRequestContextWithTests> {
  // Get the base context first
  const baseContext = await handlePullRequestBase(payload)

  // Fetch all existing test files
  const existingTestFiles = await getAllTestFiles(
    baseContext.owner,
    baseContext.repo,
    baseContext.headRef
  )

  // Combine base context with test files
  return {
    ...baseContext,
    existingTestFiles
  }
}

/**
 * Removes a label from a GitHub issue/pull request
 * Used after the agents complete their work
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param issueNumber - Issue/PR number
 * @param label - Label to remove
 */
export async function removeLabel(
  owner: string,
  repo: string,
  issueNumber: number,
  label: string
) {
  try {
    await octokit.issues.removeLabel({
      owner,
      repo,
      issue_number: issueNumber,
      name: label
    })
  } catch (error: any) {
    // Ignore 404 errors (label doesn't exist)
    if (error.status !== 404) {
      console.error(`Error removing label ${label}:`, error)
    }
  }
}
