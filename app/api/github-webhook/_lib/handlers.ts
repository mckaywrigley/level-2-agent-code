/*
<ai_context>
This file contains functions for handling GitHub webhook events.
</ai_context>
*/

import { getFileContent, octokit } from "./github"

export interface PullRequestContext {
  owner: string
  repo: string
  pullNumber: number
  headRef: string
  baseRef: string
  title: string
  changedFiles: {
    filename: string
    patch: string
    status: string
    additions: number
    deletions: number
    content?: string
  }[]
  commitMessages: string[]
}

export interface PullRequestContextWithTests extends PullRequestContext {
  existingTestFiles: {
    filename: string
    content: string
  }[]
}

export async function handlePullRequestBase(
  payload: any
): Promise<PullRequestContext> {
  const owner = payload.repository.owner.login
  const repo = payload.repository.name
  const pullNumber = payload.pull_request.number
  const headRef = payload.pull_request.head.ref
  const baseRef = payload.pull_request.base.ref
  const title = payload.pull_request.title

  const filesRes = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: pullNumber
  })

  const changedFiles = await Promise.all(
    filesRes.data.map(async file => {
      let content: string | undefined
      if (file.status !== "removed") {
        content = await getFileContent(owner, repo, file.filename, headRef)
      }
      return {
        filename: file.filename,
        patch: file.patch ?? "",
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        content
      }
    })
  )

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

async function getAllTestFiles(
  owner: string,
  repo: string,
  ref: string,
  dirPath = "__tests__"
): Promise<{ filename: string; content: string }[]> {
  const results: { filename: string; content: string }[] = []

  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: dirPath,
      ref
    })

    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.type === "file") {
          const fileContent = await getFileContent(owner, repo, item.path, ref)
          if (fileContent) {
            results.push({
              filename: item.path,
              content: fileContent
            })
          }
        } else if (item.type === "dir") {
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

export async function handlePullRequestForTestAgent(
  payload: any
): Promise<PullRequestContextWithTests> {
  const baseContext = await handlePullRequestBase(payload)

  const existingTestFiles = await getAllTestFiles(
    baseContext.owner,
    baseContext.repo,
    baseContext.headRef
  )

  return {
    ...baseContext,
    existingTestFiles
  }
}
