/*
<ai_context>
This file contains functions for generating and committing tests to a GitHub PR.
It analyzes changed files and generates appropriate unit or e2e tests.
</ai_context>
*/

import { generateObject, generateText } from "ai"
import { parseStringPromise } from "xml2js"
import { z } from "zod"
import { createPlaceholderComment, updateComment } from "./comments"
import { octokit } from "./github"
import { PullRequestContextWithTests, removeLabel } from "./handlers"
import { getLLMModel } from "./llm"

// Interface defining the structure of a test proposal from the AI
interface TestProposal {
  filename: string // Path to the test file
  testType?: "unit" | "e2e" // Type of test to generate
  testContent: string // The actual test code
  actions?: {
    // Actions to take with the file
    action: "create" | "update" | "rename"
    oldFilename?: string // Used when renaming files
  }
}

// Label that triggers the test generation process when added to a PR
export const TEST_GENERATION_LABEL = "agent-generate-tests"

// Zod schema for validating the AI's decision about whether to generate tests
const gatingSchema = z.object({
  decision: z.object({
    shouldGenerateTests: z.boolean(),
    reasoning: z.string(),
    recommendation: z.string().optional()
  })
})

/**
 * Parses the XML response from the AI model into structured test proposals
 *
 * @param xmlText - The XML string from the AI model
 * @returns Array of parsed test proposals
 */
async function parseTestXml(xmlText: string): Promise<TestProposal[]> {
  // Extract the tests XML portion from the response
  const startTag = "<tests>"
  const endTag = "</tests>"
  const startIndex = xmlText.indexOf(startTag)
  const endIndex = xmlText.indexOf(endTag) + endTag.length
  if (startIndex === -1 || endIndex === -1) return []

  // Parse the XML into a JavaScript object
  const xmlPortion = xmlText.slice(startIndex, endIndex)
  const parsed = await parseStringPromise(xmlPortion)
  const proposals: TestProposal[] = []

  // Extract root element and validate structure
  const root = parsed.tests
  if (!root?.testProposals) return []

  // Parse each test proposal
  const testProposalsArr = root.testProposals[0].proposal
  if (!Array.isArray(testProposalsArr)) return []

  for (const item of testProposalsArr) {
    // Extract basic test information
    const filename = item.filename?.[0] ?? ""
    const testType = item.testType?.[0] ?? ""
    const testContent = item.testContent?.[0] ?? ""

    // Parse action information
    const actionNode = item.actions?.[0]
    let action: "create" | "update" | "rename" = "create"
    let oldFilename: string | undefined

    // Determine the action type
    if (actionNode?.action?.[0]) {
      const raw = actionNode.action[0]
      if (raw === "update" || raw === "rename" || raw === "create") {
        action = raw
      }
    }

    // Get the old filename if this is a rename operation
    if (actionNode?.oldFilename?.[0]) {
      oldFilename = actionNode.oldFilename[0]
    }

    // Skip if required fields are missing
    if (!filename || !testContent) continue

    // Add the proposal to our results
    proposals.push({
      filename,
      testType: testType === "e2e" ? "e2e" : "unit",
      testContent,
      actions: {
        action,
        oldFilename
      }
    })
  }

  return proposals
}

/**
 * Finalizes test proposals by ensuring correct file extensions based on content
 *
 * @param proposals - Array of raw test proposals
 * @param changedFiles - Information about files changed in the PR
 * @returns Array of finalized test proposals
 */
function finalizeTestProposals(
  proposals: TestProposal[],
  changedFiles: PullRequestContextWithTests["changedFiles"]
): TestProposal[] {
  return proposals.map(proposal => {
    // Determine if the test is for React-related code
    const reactRelated = changedFiles.some(file => {
      if (!file.content) return false
      return (
        file.filename ===
          proposal.filename
            .replace("__tests__/unit/", "")
            .replace("__tests__/e2e/", "")
            .replace(".test.tsx", "")
            .replace(".test.ts", "") ||
        file.filename.endsWith(".tsx") ||
        file.content.includes("import React") ||
        file.content.includes('from "react"') ||
        file.filename.includes("app/")
      )
    })

    // Ensure correct file extension based on content type
    if (reactRelated) {
      if (!proposal.filename.endsWith(".test.tsx")) {
        proposal.filename = proposal.filename.replace(
          /\.test\.ts$/,
          ".test.tsx"
        )
      }
    } else {
      if (!proposal.filename.endsWith(".test.ts")) {
        proposal.filename = proposal.filename.replace(
          /\.test\.tsx$/,
          ".test.ts"
        )
      }
    }

    return proposal
  })
}

/**
 * Generates test files based on changes in the PR
 *
 * @param context - Pull request context with test information
 * @param recommendation - Optional recommendation from the gating step
 * @returns Array of test proposals
 */
async function generateTestsForChanges(
  context: PullRequestContextWithTests,
  recommendation?: string
): Promise<TestProposal[]> {
  const { title, changedFiles, commitMessages, existingTestFiles } = context

  // Format existing test files for the prompt
  const existingTestsPrompt = existingTestFiles
    .map(f => `Existing test file: ${f.filename}\n---\n${f.content}\n---\n`)
    .join("\n")

  // Format changed files for the prompt
  const changedFilesPrompt = changedFiles
    .map(file => {
      if (file.excluded) {
        return `File: ${file.filename}\nStatus: ${file.status}\n[EXCLUDED FROM PROMPT]\n`
      }
      return `File: ${file.filename}\nStatus: ${file.status}\nPatch:\n${file.patch}\nCurrent Content:\n${file.content ?? "N/A"}\n`
    })
    .join("\n---\n")

  // Construct the prompt for the AI model
  const prompt = `
You are an expert software developer specializing in writing tests for a Next.js codebase.

You may use the recommendation below and/or go beyond it.

Recommendation: ${recommendation ?? ""}

Remember - you only generate tests for front-end code. This includes things like React components, pages, hooks, etc. You do not generate tests for back-end code. This includes things like API routes, database models, etc.

Rules for naming test files:
1) If a file is a React component (client or server) or a Next.js page, the test filename MUST end in ".test.tsx".
2) If the file is purely back-end or non-React, use ".test.ts".
3) If an existing test file has the wrong extension, propose removing/renaming it.
4) If updating an existing test file that has the correct name, just update it in place.

We have two test categories:
(1) Unit tests (Jest + Testing Library) in \`__tests__/unit/\`
(2) E2E tests (Playwright) in \`__tests__/e2e/\`

If an existing test already covers related functionality, prefer updating it rather than creating a new file. Return final content for each file you modify or create.

Other rules:
- If a React component is a Server Component, handle it asynchronously in tests. If it's a Client Component, test it normally.

Title: ${title}
Commits:
${commitMessages.map(m => `- ${m}`).join("\n")}
Changed Files:
${changedFilesPrompt}
Existing Tests:
${existingTestsPrompt}

Return ONLY valid XML in the following structure:
<tests>
  <testProposals>
    <proposal>
      <filename>__tests__/unit/... .test.ts[x]</filename>
      <testType>unit or e2e</testType>
      <testContent>...</testContent>
      <actions>
        <action>create</action> OR <action>update</action> OR <action>rename</action>
        <!-- if rename -->
        <oldFilename>__tests__/unit/... .test.ts</oldFilename>
      </actions>
    </proposal>
  </testProposals>
</tests>

ONLY return the <tests> XML with proposals. Do not add extra commentary.
`

  try {
    // Get the configured LLM model and generate the tests
    const model = getLLMModel()
    const { text } = await generateText({
      model,
      prompt
    })

    // Parse and finalize the test proposals
    const rawProposals = await parseTestXml(text)
    return finalizeTestProposals(rawProposals, changedFiles)
  } catch {
    return []
  }
}

/**
 * Commits generated test files to the PR branch
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param branchName - Branch to commit to
 * @param proposals - Array of test proposals to commit
 */
async function commitTestsToExistingBranch(
  owner: string,
  repo: string,
  branchName: string,
  proposals: TestProposal[]
) {
  for (const proposal of proposals) {
    const action = proposal.actions?.action ?? "create"
    const oldFilename = proposal.actions?.oldFilename

    // Handle file renames
    if (
      action === "rename" &&
      oldFilename &&
      oldFilename !== proposal.filename
    ) {
      try {
        // Delete the old file first
        const { data: oldFile } = await octokit.repos.getContent({
          owner,
          repo,
          path: oldFilename,
          ref: branchName
        })
        if ("sha" in oldFile) {
          await octokit.repos.deleteFile({
            owner,
            repo,
            path: oldFilename,
            message: `Rename ${oldFilename} to ${proposal.filename}`,
            branch: branchName,
            sha: oldFile.sha
          })
        }
      } catch (err: any) {
        if (err.status !== 404) throw err
      }
    }

    try {
      // Check if the file already exists
      const { data: existingFile } = await octokit.repos.getContent({
        owner,
        repo,
        path: proposal.filename,
        ref: branchName
      })

      // Create or update the file
      const contentBase64 = Buffer.from(proposal.testContent, "utf8").toString(
        "base64"
      )

      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: proposal.filename,
        message: `Add/Update tests: ${proposal.filename}`,
        content: contentBase64,
        branch: branchName,
        sha: "sha" in existingFile ? existingFile.sha : undefined
      })
    } catch (error: any) {
      if (error.status === 404) {
        // File doesn't exist, create it
        const contentBase64 = Buffer.from(
          proposal.testContent,
          "utf8"
        ).toString("base64")
        await octokit.repos.createOrUpdateFileContents({
          owner,
          repo,
          path: proposal.filename,
          message: `Add/Update tests: ${proposal.filename}`,
          content: contentBase64,
          branch: branchName
        })
      } else {
        throw error
      }
    }
  }
}

/**
 * Updates the PR comment with the results of test generation
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param commentId - ID of the comment to update
 * @param headRef - Branch name
 * @param testProposals - Array of generated test proposals
 */
async function updateCommentWithResults(
  owner: string,
  repo: string,
  commentId: number,
  headRef: string,
  testProposals: TestProposal[]
) {
  const testList = testProposals.map(t => `- **${t.filename}**`).join("\n")
  const body = `### AI Test Generator

${
  testProposals.length > 0
    ? `✅ Added/updated these test files on branch \`${headRef}\`:
${testList}

*(Pull from that branch to see & modify them.)*`
    : `⚠️ No test proposals were generated.`
}`
  await updateComment(owner, repo, commentId, body)
}

/**
 * Initial check to determine if test generation is needed
 *
 * @param context - Pull request context with test information
 * @returns Decision object with whether to generate tests and why
 */
async function gatingStep(context: PullRequestContextWithTests) {
  const { title, changedFiles, commitMessages, existingTestFiles } = context

  // Format existing tests for the prompt
  const existingTestsPrompt = existingTestFiles
    .map(
      f => `
Existing test file: ${f.filename}
---
${f.content}
---
`
    )
    .join("\n")

  // Format changed files for the prompt
  const changedFilesPrompt = changedFiles
    .map(file => {
      if (file.excluded) {
        return `File: ${file.filename}\nStatus: ${file.status}\n[EXCLUDED]\n`
      }
      return `File: ${file.filename}\nStatus: ${file.status}\nPatch:\n${file.patch}\nContent:\n${file.content ?? "N/A"}\n`
    })
    .join("\n---\n")

  // Construct the prompt for the AI model
  const prompt = `
You are an expert in deciding if front-end tests are needed for these changes.

You have the PR title, commits, and file diffs/content. Only return the object in JSON format: {"decision":{"shouldGenerateTests":true or false,"reasoning":"some text"}}

Title: ${title}
Commits:
${commitMessages.map(m => `- ${m}`).join("\n")}
Changed Files:
${changedFilesPrompt}
Existing Tests:
${existingTestsPrompt}
`

  try {
    // Get the configured LLM model and generate the decision
    const model = getLLMModel()
    const result = await generateObject({
      model,
      schema: gatingSchema,
      schemaName: "decision",
      schemaDescription: "Decision for test generation",
      prompt
    })

    return {
      shouldGenerate: result.object.decision.shouldGenerateTests,
      reason: result.object.decision.reasoning,
      recommendation: result.object.decision.recommendation
    }
  } catch {
    return { shouldGenerate: false, reason: "Error in gating check" }
  }
}

/**
 * Main handler for the test generation process
 * Coordinates the entire flow from decision to generation to commit
 *
 * @param context - Pull request context with test information
 */
export async function handleTestGeneration(
  context: PullRequestContextWithTests
) {
  const { owner, repo, pullNumber, headRef } = context
  let commentId: number | undefined

  try {
    // Create initial placeholder comment
    commentId = await createPlaceholderComment(
      owner,
      repo,
      pullNumber,
      "🧪 AI Test Generation in progress..."
    )

    // Check if we should generate tests
    const { shouldGenerate, reason, recommendation } = await gatingStep(context)
    if (!shouldGenerate) {
      await updateComment(
        owner,
        repo,
        commentId,
        `⏭️ Skipping test generation: ${reason}`
      )
      return
    }

    // Generate and commit the tests
    const testProposals = await generateTestsForChanges(context, recommendation)
    if (testProposals.length > 0) {
      await commitTestsToExistingBranch(owner, repo, headRef, testProposals)
    }

    // Update the comment with results
    await updateCommentWithResults(
      owner,
      repo,
      commentId,
      headRef,
      testProposals
    )

    // Remove the generation label
    await removeLabel(owner, repo, pullNumber, TEST_GENERATION_LABEL)
  } catch (err) {
    console.error("Error in handleTestGeneration:", err)
    if (typeof commentId !== "undefined") {
      await updateComment(
        owner,
        repo,
        commentId,
        "❌ Error generating tests. Please check the logs."
      )
    }
  }
}
