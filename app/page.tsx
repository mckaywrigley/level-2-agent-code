/*
<ai_context>
This client page shows a basic home page.
</ai_context>
*/

"use client"

import { Button } from "@/components/ui/button"
import Link from "next/link"

export default function HomePage() {
  function handleClick() {
    alert("You clicked me!")
  }

  return (
    <div className="flex-1 p-4 pt-0">
      <h1>Welcome to the Level 2 Coding Agent Lesson</h1>

      <Link href="/about">Go to the About Page</Link>

      <Button onClick={handleClick}>Click me</Button>
    </div>
  )
}
