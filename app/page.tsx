/*
<ai_context>
This server page shows a basic home page.
</ai_context>
*/

"use server"

import Link from "next/link"

export default async function HomePage() {
  return (
    <div className="flex-1 p-4 pt-0">
      <h1>Welcome to the Level 2 Coding Agent Lesson</h1>

      <Link href="/about">Go to the About Page</Link>
    </div>
  )
}
