import { describe, it, expect, beforeEach, vi } from "vitest";
import { SubmitStep } from "../../../src/orchestrator/steps/submit.js";
import { AgentState } from "../../../src/orchestrator/state.js";
import * as provider from "../../../src/inference/provider.js";
import * as git from "../../../src/adapters/git.js";
import * as github from "../../../src/adapters/github.js";
import * as fs from "fs";
import * as readline from "readline/promises";

vi.mock("../../../src/inference/provider.js", () => ({
  createProvider: vi.fn(),
  getToolsForLLM: vi.fn(),
  getDefaultModel: vi.fn()
}));

vi.mock("../../../src/adapters/git.js", () => ({
  getDiff: vi.fn(),
  getModifiedFiles: vi.fn(),
  createBranch: vi.fn(),
  commitChanges: vi.fn(),
  pushBranch: vi.fn(),
  getDefaultBranch: vi.fn(),
  setRemoteUrl: vi.fn(),
  getDiffStat: vi.fn()
}));

vi.mock("../../../src/adapters/github.js", () => ({
  createPullRequest: vi.fn(),
  forkRepository: vi.fn()
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn()
}));

vi.mock("readline/promises", () => ({
  createInterface: vi.fn()
}));

describe("SubmitStep", () => {
  let step: SubmitStep;
  let state: AgentState;
  let deps: any;
  let mockProvider: any;

  beforeEach(() => {
    vi.resetAllMocks();
    
    mockProvider = {
      complete: vi.fn().mockResolvedValue({
        content: "## Description\nFixed the bug."
      })
    };

    (provider.createProvider as any).mockReturnValue(mockProvider);
    
    (git.getDiff as any).mockResolvedValue("actual diff content");
    (git.getModifiedFiles as any).mockResolvedValue(["src/index.ts"]);
    (git.getDefaultBranch as any).mockResolvedValue("main");
    (github.createPullRequest as any).mockResolvedValue({ html_url: "https://github.com/test/repo/pull/1" });

    (fs.existsSync as any).mockReturnValue(true);

    deps = {
      model: "test-model",
      maxIterations: 1,
      executeTool: vi.fn()
    };
    
    step = new SubmitStep(deps);
    
    state = {
      repoUrl: "https://github.com/test/repo",
      repoPath: "/tmp/test-repo",
      issueText: "Fix bug",
      currentStep: "SUBMIT",
      history: [{ step: "PLAN", result: "fix it" }],
      visitedFiles: ["src/index.ts"],
      errorLogs: []
    } as any;

    process.env.GH_TOKEN = "fake-token";
  });

  it("generates narrative and submits PR", async () => {
    // Mock interactive review to auto-approve
    const mockRl = {
      question: vi.fn().mockResolvedValue("y"),
      close: vi.fn()
    };
    (readline.createInterface as any).mockReturnValue(mockRl);

    const result = await step.execute(state);
    
    expect(result.nextStep).toBe("SUBMIT");
    expect(github.createPullRequest).toHaveBeenCalled();
    expect(state.history.some(h => h.action === "Submitted PR")).toBe(true);
  });

  it("handles empty diff by aborting", async () => {
    (git.getDiff as any).mockResolvedValue("");

    const result = await step.execute(state);
    
    expect(github.createPullRequest).not.toHaveBeenCalled();
    expect(state.errorLogs.some(e => e.includes("diff is empty"))).toBe(true);
  });
});
