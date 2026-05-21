import { describe, it, expect, beforeEach, vi } from "vitest";
import { PlanStep } from "../../../src/orchestrator/steps/plan.js";
import { AgentState } from "../../../src/orchestrator/state.js";
import * as provider from "../../../src/inference/provider.js";

vi.mock("../../../src/inference/provider.js", () => ({
  createProvider: vi.fn(),
  getToolsForLLM: vi.fn(),
  getDefaultModel: vi.fn()
}));

describe("PlanStep", () => {
  let step: PlanStep;
  let state: AgentState;
  let deps: any;
  let mockProvider: any;

  beforeEach(() => {
    vi.resetAllMocks();
    
    mockProvider = {
      complete: vi.fn().mockResolvedValue({
        content: "I have a plan to fix the code."
      })
    };

    (provider.createProvider as any).mockReturnValue(mockProvider);
    
    deps = {
      model: "test-model",
      maxIterations: 1
    };
    
    step = new PlanStep(deps);
    
    state = {
      repoUrl: "https://github.com/test/repo",
      repoPath: "/tmp/test-repo",
      issueText: "Fix the bug",
      currentStep: "PLAN",
      visitedFiles: ["src/math.ts"],
      history: [],
      errorLogs: []
    } as any;
  });

  it("creates a plan and transitions to EXECUTE", async () => {
    const result = await step.execute(state);
    
    expect(result.nextStep).toBe("EXECUTE");
    expect(mockProvider.complete).toHaveBeenCalled();
    expect(state.history[0].action).toBe("Created fix plan");
  });

  it("backtracks to EXPLORE if no files visited", async () => {
    state.visitedFiles = [];
    const result = await step.execute(state);
    
    expect(result.nextStep).toBe("EXPLORE");
    expect(mockProvider.complete).not.toHaveBeenCalled();
  });
});
