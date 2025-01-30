/*
<ai_context>
This route contains the main logic for handling GitHub webhook events.
It acts as the entry point for all GitHub webhook requests and routes them
to the appropriate handlers based on the event type and action.
</ai_context>
*/

import { NextRequest, NextResponse } from "next/server"
import {
  handlePullRequestBase,
  handlePullRequestForTestAgent
} from "./_lib/handlers"
import { handleReviewAgent, REVIEW_LABEL } from "./_lib/review-agent"
import { handleTestGeneration, TEST_GENERATION_LABEL } from "./_lib/test-agent"

/**
 * Handles POST requests from GitHub webhooks
 * This is the main entry point for all GitHub webhook events
 *
 * @param request - The incoming webhook request from GitHub
 * @returns A response indicating success or failure
 */
export async function POST(request: NextRequest) {
  try {
    // Extract and parse the raw webhook payload
    const rawBody = await request.text()
    const payload = JSON.parse(rawBody)

    // Get the event type from the GitHub webhook headers
    // This tells us what kind of event we're dealing with (PR, issue, push, etc.)
    const eventType = request.headers.get("x-github-event")

    // Handle pull request events
    if (eventType === "pull_request") {
      // Handle new pull requests
      if (payload.action === "opened") {
        // When a PR is opened, we automatically run the review agent
        const context = await handlePullRequestBase(payload)
        await handleReviewAgent(context)
      }

      // Handle label additions to pull requests
      if (payload.action === "labeled") {
        const labelName = payload.label?.name

        // If the review label was added, run the review agent
        if (labelName === REVIEW_LABEL) {
          const context = await handlePullRequestBase(payload)
          await handleReviewAgent(context)
        }

        // If the test generation label was added, run the test agent
        if (labelName === TEST_GENERATION_LABEL) {
          const context = await handlePullRequestForTestAgent(payload)
          await handleTestGeneration(context)
        }
      }
    }

    // Return a success response
    return NextResponse.json({ message: "OK" })
  } catch (error) {
    // Log and return any errors that occur
    console.error("Error in webhook route:", error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
