/*
<ai_context>
This file contains functions for generating and committing tests to a GitHub PR.
</ai_context>
*/

import { generateObject, generateText } from "ai"
import { parseStringPromise } from "xml2js"
import { z } from "zod"
import { createPlaceholderComment, updateComment } from "./comments"
import { octokit } from "./github"
import { PullRequestContextWithTests, removeLabel } from "./handlers"
import { getLLMModel } from "./llm"

interface TestProposal {
  filename: string
  testType?: "unit" | "e2e"
  testContent: string
  actions?: {
    action: "create" | "update" | "rename"
    oldFilename?: string
  }
}

export const TEST_GENERATION_LABEL = "agent-generate-tests"

const gatingSchema = z.object({
  decision: z.object({
    shouldGenerateTests: z.boolean(),
    reasoning: z.string(),
    recommendation: z.string().optional()
  })
})

async function parseTestXml(xmlText: string): Promise<TestProposal[]> {
  const startTag = "<tests>"
  const endTag = "</tests>"
  const startIndex = xmlText.indexOf(startTag)
  const endIndex = xmlText.indexOf(endTag) + endTag.length
  if (startIndex === -1 || endIndex === -1) return []
  const xmlPortion = xmlText.slice(startIndex, endIndex)
  const parsed = await parseStringPromise(xmlPortion)
  const proposals: TestProposal[] = []
  const root = parsed.tests
  if (!root?.testProposals) return []
  const testProposalsArr = root.testProposals[0].proposal
  if (!Array.isArray(testProposalsArr)) return []
  for (const item of testProposalsArr) {
    const filename = item.filename?.[0] ?? ""
    const testType = item.testType?.[0] ?? ""
    const testContent = item.testContent?.[0] ?? ""
    const actionNode = item.actions?.[0]
    let action: "create" | "update" | "rename" = "create"
    let oldFilename: string | undefined
    if (actionNode?.action?.[0]) {
      const raw = actionNode.action[0]
      if (raw === "update" || raw === "rename" || raw === "create") {
        action = raw
      }
    }
    if (actionNode?.oldFilename?.[0]) {
      oldFilename = actionNode.oldFilename[0]
    }
    if (!filename || !testContent) continue
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

function finalizeTestProposals(
  proposals: TestProposal[],
  changedFiles: PullRequestContextWithTests["changedFiles"]
): TestProposal[] {
  return proposals.map(proposal => {
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

async function generateTestsForChanges(
  context: PullRequestContextWithTests,
  recommendation?: string
): Promise<TestProposal[]> {
  const { title, changedFiles, commitMessages, existingTestFiles } = context

  const existingTestsPrompt = existingTestFiles
    .map(f => `Existing test file: ${f.filename}\n---\n${f.content}\n---\n`)
    .join("\n")

  const changedFilesPrompt = changedFiles
    .map(file => {
      if (file.excluded) {
        return `File: ${file.filename}\nStatus: ${file.status}\n[EXCLUDED FROM PROMPT]\n`
      }
      return `File: ${file.filename}\nStatus: ${file.status}\nPatch:\n${file.patch}\nCurrent Content:\n${file.content ?? "N/A"}\n`
    })
    .join("\n---\n")

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
    const model = getLLMModel()
    const { text } = await generateText({
      model,
      prompt
    })
    const rawProposals = await parseTestXml(text)
    return finalizeTestProposals(rawProposals, changedFiles)
  } catch {
    return []
  }
}

async function commitTestsToExistingBranch(
  owner: string,
  repo: string,
  branchName: string,
  proposals: TestProposal[]
) {
  for (const proposal of proposals) {
    const action = proposal.actions?.action ?? "create"
    const oldFilename = proposal.actions?.oldFilename

    if (
      action === "rename" &&
      oldFilename &&
      oldFilename !== proposal.filename
    ) {
      try {
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
      const { data: existingFile } = await octokit.repos.getContent({
        owner,
        repo,
        path: proposal.filename,
        ref: branchName
      })
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

async function gatingStep(context: PullRequestContextWithTests) {
  const { title, changedFiles, commitMessages, existingTestFiles } = context

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

  const changedFilesPrompt = changedFiles
    .map(file => {
      if (file.excluded) {
        return `File: ${file.filename}\nStatus: ${file.status}\n[EXCLUDED]\n`
      }
      return `File: ${file.filename}\nStatus: ${file.status}\nPatch:\n${file.patch}\nContent:\n${file.content ?? "N/A"}\n`
    })
    .join("\n---\n")

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

export async function handleTestGeneration(
  context: PullRequestContextWithTests
) {
  const { owner, repo, pullNumber, headRef } = context
  let commentId: number | undefined

  try {
    commentId = await createPlaceholderComment(
      owner,
      repo,
      pullNumber,
      "🧪 AI Test Generation in progress..."
    )

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

    const testProposals = await generateTestsForChanges(context, recommendation)
    if (testProposals.length > 0) {
      await commitTestsToExistingBranch(owner, repo, headRef, testProposals)
    }

    await updateCommentWithResults(
      owner,
      repo,
      commentId,
      headRef,
      testProposals
    )
    await removeLabel(owner, repo, pullNumber, TEST_GENERATION_LABEL)
  } catch (err) {
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
