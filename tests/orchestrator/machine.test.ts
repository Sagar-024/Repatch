import { describe, it, expect, beforeEach, vi } from "vitest";
import { Orchestrator } from "../../src/orchestrator/machine.js";
import { AgentState } from "../../src/orchestrator/state.js";
import * as registry from "../../src/tools/registry.js";
import { logger } from "../../src/utils/logger.js";
import * as path from "path";

// Mock Steps
vi.mock("../../src/orchestrator/steps/understand.js", () => {
  return {
    UnderstandStep: class {
      execute = vi.fn().mockImplementation(async (state) => ({ nextStep: "EXPLORE", state }));
    }
  };
});

vi.mock("../../src/orchestrator/steps/explore.js", () => {
  return {
    ExploreStep: class {
      execute = vi.fn().mockImplementation(async (state) => ({ nextStep: "REPRODUCE", state }));
    }
  };
});

// Mock Registry
vi.mock("../../src/tools/registry.js", () => ({
  getTool: vi.fn()
}));

// Mock Logger
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn()
  }
}));

describe("Orchestrator", () => {
  let orchestrator: Orchestrator;
  let state: AgentState;

  beforeEach(() => {
    vi.clearAllMocks();
    orchestrator = new Orchestrator("test-model");
    state = {
      repoUrl: "https://github.com/test/repo",
      repoPath: "/tmp/test-repo",
      issueText: "Fix bug",
      currentStep: "UNDERSTAND",
      history: [],
      visitedFiles: [],
      errorLogs: []
    } as any;
  });

  it("transitions between steps", async () => {
    const newState = await orchestrator.transition(state);
    expect(newState.currentStep).toBe("EXPLORE");
    expect(logger.info).toHaveBeenCalledWith("Step: UNDERSTAND");
  });

  it("handles tool execution", async () => {
    const mockTool = {
      handler: vi.fn().mockResolvedValue("tool result")
    };
    (registry.getTool as any).mockReturnValue(mockTool);

    const repoPath = path.resolve("/tmp/repo");
    const testFile = "test.ts";
    const expectedPath = path.resolve(repoPath, testFile);

    const result = await (orchestrator as any).executeTool(
      { name: "read_file", arguments: { filePath: testFile } },
      { repoPath },
      state
    );

    expect(result).toBe("tool result");
    expect(state.visitedFiles).toContain(expectedPath);
  });
});
