import HomePage from "@/app/page"
import "@testing-library/jest-dom"
import { render, screen } from "@testing-library/react"

jest.mock("next/link", () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  )
})

describe("HomePage (Server Component)", () => {
  it("renders the main heading and link", async () => {
    const Page = await HomePage()
    render(Page)
    
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Level 2 Coding Agent")
    expect(screen.getByRole("link", { name: "About Page" })).toHaveAttribute("href", "/about")
  })
})