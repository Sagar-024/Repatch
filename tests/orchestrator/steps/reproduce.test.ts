import { describe, it, expect, beforeEach, vi } from "vitest";
import { ReproduceStep } from "../../../src/orchestrator/steps/reproduce.js";
import { AgentState } from "../../../src/orchestrator/state.js";
import * as provider from "../../../src/inference/provider.js";

// Mock providers
vi.mock("../../../src/inference/provider.js", () => ({
  createProvider: vi.fn(),
  getToolsForLLM: vi.fn(),
  getDefaultModel: vi.fn()
}));

describe("ReproduceStep", () => {
  let step: ReproduceStep;
  let state: AgentState;
  let deps: any;
  let mockProvider: any;

  beforeEach(() => {
    vi.resetAllMocks();
    
    mockProvider = {
      complete: vi.fn().mockResolvedValue({
        content: "I will run the test",
        toolCalls: [
          { name: "run_command", arguments: { cmd: "npm test" } }
        ]
      })
    };

    (provider.createProvider as any).mockReturnValue(mockProvider);
    (provider.getToolsForLLM as any).mockResolvedValue([]);
    (provider.getDefaultModel as any).mockReturnValue("test-model");
    
    deps = {
      model: "test-model",
      maxIterations: 5,
      executeTool: vi.fn().mockResolvedValue({ stdout: "failure", stderr: "", exitCode: 1 })
    };
    
    step = new ReproduceStep(deps);
    
    state = {
      repoUrl: "https://github.com/test/repo",
      repoPath: "/tmp/test-repo",
      issueText: "Fix the bug",
      currentStep: "REPRODUCE",
      history: [],
      visitedFiles: [],
      errorLogs: []
    } as any;
  });

  it("executes the reproduction loop", async () => {
    const result = await step.execute(state);
    
    expect(result.nextStep).toBe("PLAN");
    expect(deps.executeTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "run_command" }),
      expect.any(Object)
    );
    expect(state.reproductionTest).toBe("npm test");
    expect(state.reproductionFailureOutput).toContain("failure");
  });
});
