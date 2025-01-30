/*
<ai_context>
This file contains functions for generating and committing code reviews to a GitHub PR.
It uses an AI model to analyze code changes and provide structured feedback.
</ai_context>
*/

import { generateText } from "ai"
import { parseStringPromise } from "xml2js"
import { createPlaceholderComment, updateComment } from "./comments"
import { PullRequestContext, removeLabel } from "./handlers"
import { getLLMModel } from "./llm"

// Label that triggers the review process when added to a PR
export const REVIEW_LABEL = "agent-review-pr"

/**
 * Parses the XML response from the AI model into a structured review format
 *
 * @param xmlText - The XML string from the AI model
 * @returns Parsed review data with summary, file analyses, and suggestions
 */
async function parseReviewXml(xmlText: string) {
  try {
    // Extract the review XML portion from the response
    const startTag = "<review>"
    const endTag = "</review>"
    const startIndex = xmlText.indexOf(startTag)
    const endIndex = xmlText.indexOf(endTag) + endTag.length

    // Handle case where no review XML is found
    if (startIndex === -1 || endIndex === -1) {
      console.warn("No <review> XML found in AI output.")
      return {
        summary: "Could not parse AI response.",
        fileAnalyses: [],
        overallSuggestions: []
      }
    }

    // Extract and parse the XML portion
    const xmlPortion = xmlText.slice(startIndex, endIndex)
    const parsed = await parseStringPromise(xmlPortion)

    // Transform the parsed XML into a structured format
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

/**
 * Updates the GitHub comment with the formatted review content
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param commentId - ID of the comment to update
 * @param analysis - Parsed review data
 */
async function updateCommentWithReview(
  owner: string,
  repo: string,
  commentId: number,
  analysis: Awaited<ReturnType<typeof parseReviewXml>>
) {
  // Format the review data into a markdown comment
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

/**
 * Generates a code review using the AI model
 *
 * @param context - Pull request context containing files and metadata
 * @returns Parsed review data
 */
async function generateReview(context: PullRequestContext) {
  const { title, changedFiles, commitMessages } = context

  // Format changed files for the prompt
  const changedFilesPrompt = changedFiles
    .map(file => {
      if (file.excluded) {
        return `File: ${file.filename}\nStatus: ${file.status}\n[EXCLUDED FROM PROMPT]\n`
      }
      return `File: ${file.filename}\nStatus: ${file.status}\nPatch (diff):\n${file.patch}\nCurrent Content:\n${file.content ?? "N/A"}\n`
    })
    .join("\n---\n")

  // Construct the prompt for the AI model
  const prompt = `
You are an expert code reviewer. Provide feedback on the following pull request changes in clear, concise paragraphs. 
Do not use code blocks for regular text. Format any suggestions as single-line bullet points.

PR Title: ${title}
Commit Messages:
${commitMessages.map(msg => `- ${msg}`).join("\n")}
Changed Files:
${changedFilesPrompt}


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

ONLY return the <review> XML with the summary, fileAnalyses, and overallSuggestions. Do not add extra commentary.
`

  try {
    // Get the configured LLM model and generate the review
    const model = getLLMModel()
    const { text } = await generateText({
      model,
      prompt
    })

    // Log the AI response for debugging
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

/**
 * Main handler for the review process
 * Creates a placeholder comment, generates the review, updates the comment,
 * and removes the review label
 *
 * @param context - Pull request context
 */
export async function handleReviewAgent(context: PullRequestContext) {
  const { owner, repo, pullNumber } = context
  let commentId: number | undefined

  try {
    // Create a placeholder comment while the review is being generated
    commentId = await createPlaceholderComment(
      owner,
      repo,
      pullNumber,
      "🤖 AI Code Review in progress..."
    )

    // Generate and post the review
    const analysis = await generateReview(context)
    await updateCommentWithReview(owner, repo, commentId, await analysis)

    // Remove the review label to indicate completion
    await removeLabel(owner, repo, pullNumber, REVIEW_LABEL)
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
