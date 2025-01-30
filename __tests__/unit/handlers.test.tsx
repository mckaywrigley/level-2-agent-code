
import { removeLabel, handlePullRequestBase } from "@/app/api/github-webhook/_lib/handlers";

// We'll mock the octokit instance and getFileContent from the github module
jest.mock("@/app/api/github-webhook/_lib/github", () => ({
  octokit: {
    issues: {
      removeLabel: jest.fn().mockResolvedValue(null)
    },
    pulls: {
      listFiles: jest.fn().mockResolvedValue({ data: [] }),
      listCommits: jest.fn().mockResolvedValue({ data: [] })
    }
  },
  getFileContent: jest.fn().mockResolvedValue(null)
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

describe("handlePullRequestBase function", () => {
  const { octokit, getFileContent } = require("@/app/api/github-webhook/_lib/github");

  it("excludes large files above threshold", async () => {
    octokit.pulls.listFiles.mockResolvedValueOnce({
      data: [
        {
          filename: "big_file.js",
          patch: "",
          status: "modified",
          additions: 10000,
          deletions: 0
        }
      ]
    });
    // Simulate a large file over the threshold
    getFileContent.mockResolvedValue("x".repeat(35000));

    const result = await handlePullRequestBase({
      repository: { owner: { login: "testOwner" }, name: "testRepo" },
      pull_request: { number: 42, head: { ref: "testBranch" }, base: { ref: "main" }, title: "Test PR" }
    });

    expect(result.changedFiles[0].excluded).toBe(true);
  });

  it("does not exclude files within threshold", async () => {
    octokit.pulls.listFiles.mockResolvedValueOnce({
      data: [
        {
          filename: "normal_file.js",
          patch: "",
          status: "modified",
          additions: 50,
          deletions: 10
        }
      ]
    });
    // Simulate a file size within threshold
    getFileContent.mockResolvedValue("x".repeat(20000));

    const result = await handlePullRequestBase({
      repository: { owner: { login: "testOwner" }, name: "testRepo" },
      pull_request: { number: 42, head: { ref: "testBranch" }, base: { ref: "main" }, title: "Test PR" }
    });

    expect(result.changedFiles[0].excluded).toBe(false);
    expect(result.changedFiles[0].content).toBeDefined();
  });
});
