import HomePage from "@/app/page"
import "@testing-library/jest-dom"
import { render, screen, fireEvent } from "@testing-library/react"

jest.mock("next/link", () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  )
})

// Mock the alert function
const mockAlert = jest.fn()
window.alert = mockAlert

describe("HomePage (Client Component)", () => {
  it("renders the main heading and link", () => {
    render(<HomePage />)
    
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Welcome to the Level 2 Coding Agent Lesson"
    )
    expect(screen.getByRole("link", { name: "Go to the About Page" })).toHaveAttribute("href", "/about")
  })

  it("shows alert when button is clicked", () => {
    render(<HomePage />)
    
    const button = screen.getByRole("button", { name: "Click me" })
    fireEvent.click(button)
    
    expect(mockAlert).toHaveBeenCalledWith("You clicked me!")
  })
})