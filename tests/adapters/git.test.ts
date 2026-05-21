import { describe, it, expect, vi, beforeEach } from "vitest";
import { cloneRepo, createBranch, getModifiedFiles, getDiff, commitChanges, pushBranch, getDefaultBranch } from "../../src/adapters/git.js";
import { simpleGit } from "simple-git";

vi.mock("simple-git", () => {
  const mockGit = {
    clone: vi.fn().mockResolvedValue({}),
    checkoutLocalBranch: vi.fn().mockResolvedValue({}),
    status: vi.fn().mockResolvedValue({ modified: [], not_added: [], created: [], staged: [] }),
    add: vi.fn().mockResolvedValue({}),
    commit: vi.fn().mockResolvedValue({}),
    push: vi.fn().mockResolvedValue({}),
    getRemotes: vi.fn().mockResolvedValue([{ name: "origin" }]),
    branch: vi.fn().mockResolvedValue({ all: [], current: "" }),
    diff: vi.fn().mockResolvedValue("diff content"),
    checkIsRepo: vi.fn().mockResolvedValue(true)
  };
  return {
    simpleGit: vi.fn().mockReturnValue(mockGit)
  };
});

describe("adapters/git", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("cloneRepo", () => {
    it("clones a repo with authentication if token provided", async () => {
      process.env.GH_TOKEN = "fake-token";
      const git = simpleGit();
      (git.checkIsRepo as any).mockResolvedValue(false);
      await cloneRepo("https://github.com/owner/repo", "/tmp/dir");
      
      expect(git.clone).toHaveBeenCalledWith(
        "https://fake-token@github.com/owner/repo",
        "/tmp/dir",
        ["--depth", "1"]
      );
    });

    it("clones a repo without token if missing", async () => {
      delete process.env.GH_TOKEN;
      const git = simpleGit();
      (git.checkIsRepo as any).mockResolvedValue(false);
      await cloneRepo("https://github.com/owner/repo", "/tmp/dir");
      
      expect(git.clone).toHaveBeenCalledWith(
        "https://github.com/owner/repo",
        "/tmp/dir",
        ["--depth", "1"]
      );
    });
  });

  describe("createBranch", () => {
    it("checks out a new branch", async () => {
      await createBranch("/tmp/repo", "new-branch");
      const git = simpleGit("/tmp/repo");
      expect(git.checkoutLocalBranch).toHaveBeenCalledWith("new-branch");
    });
  });

  describe("getModifiedFiles", () => {
    it("returns a list of changed files", async () => {
      const git = simpleGit();
      (git.status as any).mockResolvedValue({
        modified: ["a.ts"],
        not_added: ["b.ts"],
        created: [],
        staged: []
      });

      const files = await getModifiedFiles("/tmp/repo");
      expect(files).toContain("a.ts");
      expect(files).toContain("b.ts");
    });
  });

  describe("getDiff", () => {
    it("returns the git diff", async () => {
      const diff = await getDiff("/tmp/repo");
      expect(diff).toBe("diff content");
      const git = simpleGit();
      expect(git.diff).toHaveBeenCalledWith(["HEAD"]);
    });
  });

  describe("commitChanges", () => {
    it("adds and commits files", async () => {
      await commitChanges("/tmp/repo", "feat: test", ["file1.ts"]);
      const git = simpleGit("/tmp/repo");
      expect(git.add).toHaveBeenCalledWith("file1.ts");
      expect(git.commit).toHaveBeenCalledWith("feat: test");
    });
  });

  describe("pushBranch", () => {
    it("pushes a branch to origin", async () => {
      const git = simpleGit();
      (git.getRemotes as any).mockResolvedValue([{ name: "origin" }]);
      await pushBranch("/tmp/repo", "feat/branch");
      expect(git.push).toHaveBeenCalledWith("origin", "feat/branch", ["--set-upstream"]);
    });

    it("throws if no remotes", async () => {
      const git = simpleGit();
      (git.getRemotes as any).mockResolvedValue([]);
      await expect(pushBranch("/tmp/repo", "feat/branch")).rejects.toThrow("No remote found");
    });
  });

  describe("getDefaultBranch", () => {
    it("detects main as default", async () => {
      const git = simpleGit();
      (git.branch as any).mockResolvedValue({ all: ["origin/main"], current: "feat/1" });
      const branch = await getDefaultBranch("/tmp/repo");
      expect(branch).toBe("main");
    });
  });
});
