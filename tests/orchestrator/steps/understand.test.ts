import { describe, it, expect, beforeEach, vi } from "vitest";
import { UnderstandStep } from "../../../src/orchestrator/steps/understand.js";
import { AgentState } from "../../../src/orchestrator/state.js";
import * as provider from "../../../src/inference/provider.js";

vi.mock("../../../src/inference/provider.js", () => ({
  createProvider: vi.fn(),
  getToolsForLLM: vi.fn(),
  getDefaultModel: vi.fn()
}));

describe("UnderstandStep", () => {
  let step: UnderstandStep;
  let state: AgentState;
  let deps: any;
  let mockProvider: any;

  beforeEach(() => {
    vi.resetAllMocks();
    
    mockProvider = {
      complete: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          summary: "Broken math function",
          rootCause: "Incorrect operator",
          strategy: "Change - to +"
        })
      })
    };

    (provider.createProvider as any).mockReturnValue(mockProvider);
    
    deps = {
      model: "test-model",
      maxIterations: 1
    };
    
    step = new UnderstandStep(deps);
    
    state = {
      repoUrl: "https://github.com/test/repo",
      repoPath: "/tmp/test-repo",
      issueText: "Math is wrong",
      currentStep: "UNDERSTAND",
      history: [],
      visitedFiles: [],
      errorLogs: []
    } as any;
  });

  it("analyzes the issue and transitions to EXPLORE", async () => {
    const result = await step.execute(state);
    
    expect(result.nextStep).toBe("EXPLORE");
    expect(mockProvider.complete).toHaveBeenCalled();
    expect(state.history[0].action).toBe("Analyzed issue");
  });
});
