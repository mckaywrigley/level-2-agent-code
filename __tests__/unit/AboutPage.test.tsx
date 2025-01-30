
import AboutPage from "@/app/about/page"
import "@testing-library/jest-dom"
import { render, screen } from "@testing-library/react"

describe("AboutPage (Server Component)", () => {
  it("renders About Page text", async () => {
    const Page = await AboutPage()
    render(Page)
    expect(screen.getByText("About Page")).toBeInTheDocument()
  })
})
