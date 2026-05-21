import { describe, it, expect, beforeEach, vi } from "vitest";
import { VerifyStep } from "../../../src/orchestrator/steps/verify.ts";
import { AgentState } from "../../../src/orchestrator/state.ts";
import * as provider from "../../../src/inference/provider.ts";
import * as lint from "../../../src/sandbox/lint.ts";

vi.mock("../../../src/inference/provider.ts", () => ({
  createProvider: vi.fn(),
  getToolsForLLM: vi.fn(),
  getDefaultModel: vi.fn()
}));

vi.mock("../../../src/sandbox/lint.ts", () => ({
  detectLintCommand: vi.fn(),
  detectFormatCommand: vi.fn()
}));

describe("VerifyStep", () => {
  let step: VerifyStep;
  let state: AgentState;
  let deps: any;
  let mockProvider: any;

  beforeEach(() => {
    vi.resetAllMocks();
    
    mockProvider = {
      complete: vi.fn()
    };

    (provider.createProvider as any).mockReturnValue(mockProvider);
    (provider.getToolsForLLM as any).mockResolvedValue([
      { name: "run_command", description: "Run a command", parameters: {} }
    ]);
    
    (lint.detectFormatCommand as any).mockReturnValue("npm run format");
    (lint.detectLintCommand as any).mockReturnValue("npm run lint");

    deps = {
      model: "test-model",
      maxIterations: 5,
      executeTool: vi.fn().mockResolvedValue({ stdout: "OK", stderr: "", exitCode: 0 })
    };
    
    step = new VerifyStep(deps);
    
    state = {
      repoUrl: "https://github.com/test/repo",
      repoPath: "/tmp/test-repo",
      issueText: "Fix bug",
      currentStep: "VERIFY",
      history: [],
      errorLogs: []
    } as any;
  });

  it("runs tests and transitions to SUBMIT if they pass", async () => {
    mockProvider.complete
      .mockResolvedValueOnce({
        content: "I will run tests",
        toolCalls: [{ name: "run_command", arguments: { cmd: "npm test" } }]
      })
      .mockResolvedValueOnce({
        content: "Done",
        toolCalls: undefined
      });

    const result = await step.execute(state);
    
    expect(result.nextStep).toBe("SUBMIT");
    expect(deps.executeTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "run_command", arguments: expect.objectContaining({ cmd: "npm test" }) }),
      expect.any(Object)
    );
    // Should also run format and lint
    expect(deps.executeTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "run_command", arguments: expect.objectContaining({ cmd: "npm run format" }) }),
      expect.any(Object)
    );
    expect(deps.executeTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "run_command", arguments: expect.objectContaining({ cmd: "npm run lint" }) }),
      expect.any(Object)
    );
  });

  it("backtracks to PLAN if lint fails", async () => {
    mockProvider.complete
      .mockResolvedValueOnce({
        content: "I will run tests",
        toolCalls: [{ name: "run_command", arguments: { cmd: "npm test" } }]
      })
      .mockResolvedValueOnce({
        content: "Done",
        toolCalls: undefined
      });

    // Mock lint failure
    deps.executeTool.mockImplementation((toolCall: any) => {
      if (toolCall.arguments.cmd === "npm run lint") {
        return Promise.resolve({ stdout: "", stderr: "Lint error", exitCode: 1 });
      }
      return Promise.resolve({ stdout: "OK", stderr: "", exitCode: 0 });
    });

    const result = await step.execute(state);
    
    expect(result.nextStep).toBe("PLAN");
    expect(state.errorLogs.some(e => e.includes("Linting failed"))).toBe(true);
  });
});
