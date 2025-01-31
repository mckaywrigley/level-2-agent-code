import { expect, test } from "@playwright/test"

test.describe("Basic E2E", () => {
  test("can visit homepage and see correct heading", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("h1")).toContainText("Welcome to the Level 2 Coding Agent Lesson")
  })

  test("shows alert when clicking the button", async ({ page }) => {
    await page.goto("/")
    
    // Create a dialog handler
    page.on("dialog", async dialog => {
      expect(dialog.message()).toBe("You clicked me!")
      await dialog.accept()
    })
    
    await page.getByRole("button", { name: "Click me" }).click()
  })
})