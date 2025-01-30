/*
<ai_context>
This file contains functions for generating and committing tests to a GitHub PR.
</ai_context>
*/

import { createOpenAI } from "@ai-sdk/openai"
import { generateObject, generateText } from "ai"
import { parseStringPromise } from "xml2js"
import { z } from "zod"
import { createPlaceholderComment, updateComment } from "./comments"
import { octokit } from "./github"
import { PullRequestContextWithTests, removeLabel } from "./handlers"

interface TestProposal {
  filename: string
  testType?: "unit" | "e2e"
  testContent: string
}

export const TEST_GENERATION_LABEL = "agent-generate-tests"

const gatingSchema = z.object({
  decision: z.object({
    shouldGenerateTests: z.boolean(),
    reasoning: z.string()
  })
})

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  compatibility: "strict"
})

async function parseTestXml(xmlText: string): Promise<TestProposal[]> {
  try {
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
      if (!filename || !testContent) continue
      proposals.push({
        filename,
        testType: testType === "e2e" ? "e2e" : "unit",
        testContent
      })
    }
    return proposals
  } catch {
    return []
  }
}

async function generateTestsForChanges(
  context: PullRequestContextWithTests
): Promise<TestProposal[]> {
  const { title, changedFiles, commitMessages, existingTestFiles } = context
  const existingTestsPrompt = existingTestFiles
    .map(f => `Existing test file: ${f.filename}\n---\n${f.content}\n---\n`)
    .join("\n")
  const prompt = `
You are an expert software developer specializing in writing tests for a Next.js codebase.

We have two categories of tests:
1) Unit tests (Jest + Testing Library) in __tests__/unit/.
2) E2E tests (Playwright) in __tests__/e2e/.

If an existing test covers related functionality, update it instead of creating a new file. Return final content for each file you modify or create.
If a React component is a Server Component, handle it asynchronously in tests. If it's a Client Component, test it normally.

Title: ${title}
Commits:
${commitMessages.map(m => `- ${m}`).join("\n")}
Changed Files:
${changedFiles
  .map(
    file => `
File: ${file.filename}
Status: ${file.status}
Patch:
${file.patch}
Current Content:
${file.content ?? "N/A"}
`
  )
  .join("\n---\n")}
Existing Tests:
${existingTestsPrompt}

Return valid XML:
<tests>
  <testProposals>
    <proposal>
      <filename>...</filename>
      <testType>...</testType>
      <testContent>...</testContent>
    </proposal>
  </testProposals>
</tests>

ONLY return the <tests> XML with proposals. Do not add extra commentary.
`
  console.log("prompt", prompt)

  try {
    const { text } = await generateText({
      model: openai("o1"),
      prompt
    })
    console.log("text", text)
    return await parseTestXml(text)
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
    const { data: refData } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branchName}`
    })
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
  const { title, changedFiles, commitMessages } = context
  const prompt = `
You are an expert in deciding if front-end tests are needed for these changes.

You have the PR title, commits, and file diffs/content. Only return the object in JSON format: {"decision":{"shouldGenerateTests":true or false,"reasoning":"some text"}}

PR Title: ${title}
Commits:
${commitMessages.map(m => `- ${m}`).join("\n")}
Changed Files:
${changedFiles
  .map(
    file => `
File: ${file.filename}
Status: ${file.status}
Patch:
${file.patch}
Content:
${file.content ?? "N/A"}
`
  )
  .join("\n---\n")}
`
  console.log("prompt", prompt)

  try {
    const result = await generateObject({
      model: openai("o1-mini", { structuredOutputs: true }),
      schema: gatingSchema,
      schemaName: "decision",
      schemaDescription: "Decision for test generation",
      prompt
    })

    console.log(
      "shouldGenerateTests",
      result.object.decision.shouldGenerateTests
    )
    console.log("reasoning", result.object.decision.reasoning)
    return {
      shouldGenerate: result.object.decision.shouldGenerateTests,
      reason: result.object.decision.reasoning
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
    const { shouldGenerate, reason } = await gatingStep(context)
    if (!shouldGenerate) {
      await updateComment(
        owner,
        repo,
        commentId,
        `⏭️ Skipping test generation: ${reason}`
      )
      return
    }
    const testProposals = await generateTestsForChanges(context)
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
