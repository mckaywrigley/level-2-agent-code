
import AboutPage from "@/app/about/page"
import "@testing-library/jest-dom"
import { render, screen, fireEvent } from "@testing-library/react"

describe("AboutPage", () => {
  it("renders About Page text", () => {
    render(<AboutPage />)
    expect(screen.getByText("About Page")).toBeInTheDocument()
  })

  it("increments count on button click", () => {
    render(<AboutPage />)
    const button = screen.getByRole("button", { name: /click me/i })
    fireEvent.click(button)
    expect(screen.getByText("Count: 1")).toBeInTheDocument()
  })
})
      