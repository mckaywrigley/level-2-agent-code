/*
<ai_context>
This client page shows an about page with a button that increments a counter.
</ai_context>
*/

"use client"

import { Button } from "@/components/ui/button"
import { useState } from "react"

export default function AboutPage() {
  const [count, setCount] = useState(0)

  return (
    <div>
      <h1>About Page</h1>

      <Button onClick={() => setCount(count + 1)}>Click me</Button>
      <p>Count: {count}</p>
    </div>
  )
}
