import { removeLabel } from "@/app/api/github-webhook/_lib/handlers";

// We'll mock the octokit instance from the github module
jest.mock("@/app/api/github-webhook/_lib/github", () => ({
  octokit: {
    issues: {
      removeLabel: jest.fn().mockResolvedValue(null)
    }
  }
}));

describe("removeLabel function", () => {
  const { octokit } = require("@/app/api/github-webhook/_lib/github");

  it("calls octokit.issues.removeLabel with correct arguments", async () => {
    await removeLabel("testOwner", "testRepo", 42, "example-label");
    expect(octokit.issues.removeLabel).toHaveBeenCalledWith({
      owner: "testOwner",
      repo: "testRepo",
      issue_number: 42,
      name: "example-label"
    });
  });

  it("ignores error if status is 404", async () => {
    octokit.issues.removeLabel.mockRejectedValueOnce({ status: 404 });
    await expect(
      removeLabel("testOwner", "testRepo", 123, "missing-label")
    ).resolves.not.toThrow();
  });

  it("logs error if status is not 404", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const exampleError = { status: 500, message: "Server error" };
    octokit.issues.removeLabel.mockRejectedValueOnce(exampleError);

    await removeLabel("testOwner", "testRepo", 999, "failing-label");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error removing label failing-label:", exampleError);

    consoleErrorSpy.mockRestore();
  });
});
