import { describe, it, expect, beforeEach, vi } from "vitest";
import { fetchIssue, getPullRequest, getPullRequestDiff, parseRepoUrl, forkRepository, createPullRequest } from "../../src/adapters/github.js";

// Mock the global fetch
global.fetch = vi.fn() as any;

describe("GitHub Adapter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.GH_TOKEN = "fake_token";
  });

  describe("parseRepoUrl", () => {
    it("parses HTTPS URL correctly", () => {
      const result = parseRepoUrl("https://github.com/microsoft/playwright");
      expect(result).toEqual({ owner: "microsoft", repo: "playwright" });
    });

    it("parses SSH URL correctly", () => {
      const result = parseRepoUrl("git@github.com:microsoft/playwright.git");
      expect(result).toEqual({ owner: "microsoft", repo: "playwright" });
    });

    it("throws error for invalid URL", () => {
      expect(() => parseRepoUrl("https://gitlab.com/repo")).toThrow("Invalid GitHub URL");
    });
  });

  describe("fetchIssue", () => {
    it("fetches issue successfully", async () => {
      const mockIssue = { number: 1, title: "Bug", body: "Description", state: "open" };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockIssue
      });

      const result = await fetchIssue("https://github.com/owner/repo", 1);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/owner/repo/issues/1",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer fake_token"
          })
        })
      );
      expect(result).toEqual(mockIssue);
    });
  });

  describe("getPullRequest", () => {
    it("fetches PR successfully", async () => {
      const mockPR = { number: 2, title: "PR", body: "PR body", state: "open", head: { ref: "feature" }, base: { ref: "main" } };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockPR
      });

      const result = await getPullRequest("https://github.com/owner/repo", 2);
      expect(result).toEqual(mockPR);
    });
  });

  describe("getPullRequestDiff", () => {
    it("fetches PR diff successfully", async () => {
      const mockDiff = "diff --git a/file b/file";
      (global.fetch as any).mockResolvedValue({
        ok: true,
        text: async () => mockDiff
      });

      const result = await getPullRequestDiff("https://github.com/owner/repo", 2);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/owner/repo/pulls/2",
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: "application/vnd.github.v3.diff"
          })
        })
      );
      expect(result).toEqual(mockDiff);
    });
  });

  describe("forkRepository", () => {
    it("forks a repo successfully", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          owner: { login: "user" },
          name: "repo",
          html_url: "https://github.com/user/repo"
        })
      });

      const result = await forkRepository("https://github.com/owner/repo");
      expect(result.owner).toBe("user");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/owner/repo/forks",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  describe("createPullRequest", () => {
    it("creates a PR successfully", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ html_url: "https://github.com/owner/repo/pull/1" })
      });

      const result = await createPullRequest("https://github.com/owner/repo", "branch", "title", "body");
      expect(result.html_url).toBe("https://github.com/owner/repo/pull/1");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/owner/repo/pulls",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            title: "title",
            body: "body",
            head: "branch",
            base: "main"
          })
        })
      );
    });
  });
});
