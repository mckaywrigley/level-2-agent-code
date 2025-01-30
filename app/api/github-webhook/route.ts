/*
<ai_context>
This route contains the main logic for handling GitHub webhook events.
</ai_context>
*/

import { NextRequest, NextResponse } from "next/server"
import {
  handlePullRequestBase,
  handlePullRequestForTestAgent
} from "./_lib/handlers"
import { handleReviewAgent } from "./_lib/review-agent"
import { handleTestGeneration } from "./_lib/test-agent"

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const payload = JSON.parse(rawBody)

    const eventType = request.headers.get("x-github-event")

    if (eventType === "pull_request") {
      if (payload.action === "opened") {
        const context = await handlePullRequestBase(payload)
        await handleReviewAgent(context)
      }

      if (payload.action === "labeled") {
        const labelName = payload.label?.name

        if (labelName === "agent-ready-for-review") {
          const context = await handlePullRequestBase(payload)
          await handleReviewAgent(context)
        }

        if (labelName === "agent-ready-for-tests") {
          const context = await handlePullRequestForTestAgent(payload)
          await handleTestGeneration(context)
        }
      }
    }

    return NextResponse.json({ message: "OK" })
  } catch (error) {
    console.error("Error in webhook route:", error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
