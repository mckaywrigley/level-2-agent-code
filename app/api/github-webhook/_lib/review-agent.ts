/*
<ai_context>
This file contains functions for generating and committing tests to a GitHub PR.
</ai_context>
*/

import { createOpenAI } from "@ai-sdk/openai"
import { generateText } from "ai"
import { parseStringPromise } from "xml2js"
import { createPlaceholderComment, updateComment } from "./comments"
import { octokit } from "./github"
import { PullRequestContext } from "./handlers"

const REVIEW_LABEL = "agent-review"

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  compatibility: "strict"
})

async function parseReviewXml(xmlText: string) {
  try {
    const startTag = "<review>"
    const endTag = "</review>"
    const startIndex = xmlText.indexOf(startTag)
    const endIndex = xmlText.indexOf(endTag) + endTag.length

    if (startIndex === -1 || endIndex === -1) {
      console.warn("No <review> XML found in AI output.")
      return {
        summary: "Could not parse AI response.",
        fileAnalyses: [],
        overallSuggestions: []
      }
    }

    const xmlPortion = xmlText.slice(startIndex, endIndex)
    const parsed = await parseStringPromise(xmlPortion)

    return {
      summary: parsed.review.summary?.[0] ?? "",
      fileAnalyses: Array.isArray(parsed.review.fileAnalyses?.[0]?.file)
        ? parsed.review.fileAnalyses[0].file.map((f: any) => ({
            path: f.path?.[0] ?? "",
            analysis: f.analysis?.[0] ?? ""
          }))
        : [],
      overallSuggestions: Array.isArray(
        parsed.review.overallSuggestions?.[0]?.suggestion
      )
        ? parsed.review.overallSuggestions[0].suggestion.map((s: any) => s)
        : []
    }
  } catch (err) {
    console.error("Error parsing review XML:", err)
    return {
      summary: "Parsing error from AI response.",
      fileAnalyses: [],
      overallSuggestions: []
    }
  }
}

async function updateCommentWithReview(
  owner: string,
  repo: string,
  commentId: number,
  analysis: Awaited<ReturnType<typeof parseReviewXml>>
) {
  const commentBody = `
### AI Code Review

**Summary**  
${analysis.summary}

${analysis.fileAnalyses
  .map((f: any) => `**File:** ${f.path}\nAnalysis:\n${f.analysis}`)
  .join("\n\n")}
  
**Suggestions**  
${analysis.overallSuggestions.map((s: string) => `- ${s}`).join("\n")}
`

  await updateComment(owner, repo, commentId, commentBody)
}

async function generateReview(context: PullRequestContext) {
  const { title, changedFiles, commitMessages } = context

  const prompt = `
You are an expert code reviewer. Provide feedback on the following pull request changes in clear, concise paragraphs. 
Do not use code blocks for regular text. Format any suggestions as single-line bullet points.

PR Title: ${title}

Commit Messages:
${commitMessages.map(msg => `- ${msg}`).join("\n")}

Changed Files:
${changedFiles
  .map(
    file => `
File: ${file.filename}
Status: ${file.status}
Patch (diff):
${file.patch}

Current Content:
${file.content ?? "N/A"}
`
  )
  .join("\n---\n")}

Return ONLY valid XML in the following structure (no extra commentary):
<review>
  <summary>[short summary of these changes]</summary>
  <fileAnalyses>
    <file>
      <path>[filename]</path>
      <analysis>[analysis for that file]</analysis>
    </file>
  </fileAnalyses>
  <overallSuggestions>
    <suggestion>[single bullet suggestion]</suggestion>
  </overallSuggestions>
</review>
`

  try {
    const { text } = await generateText({
      model: openai("o1"),
      prompt
    })

    console.log(
      "\n=== AI Response (Code Review) ===\n",
      text,
      "\n================\n"
    )

    return parseReviewXml(text)
  } catch (error) {
    console.error("Error generating or parsing AI analysis:", error)
    return {
      summary: "We were unable to analyze the code due to an internal error.",
      fileAnalyses: [],
      overallSuggestions: []
    }
  }
}

export async function handleReviewAgent(context: PullRequestContext) {
  const { owner, repo, pullNumber } = context
  let commentId: number | undefined

  try {
    commentId = await createPlaceholderComment(
      owner,
      repo,
      pullNumber,
      "🤖 AI Code Review in progress..."
    )

    const analysis = await generateReview(context)

    await updateCommentWithReview(owner, repo, commentId, await analysis)

    try {
      await octokit.issues.removeLabel({
        owner,
        repo,
        issue_number: pullNumber,
        name: REVIEW_LABEL
      })
    } catch (labelError) {
      console.warn("Failed to remove review label:", labelError)
    }
  } catch (err) {
    console.error("Error in handleReviewAgent:", err)
    if (typeof commentId !== "undefined") {
      await updateComment(
        owner,
        repo,
        commentId,
        "❌ Error during code review. Please check the logs."
      )
    }
  }
}
