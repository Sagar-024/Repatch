import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExecuteStep } from "../../../src/orchestrator/steps/execute.ts";
import { AgentState } from "../../../src/orchestrator/state.ts";
import * as provider from "../../../src/inference/provider.ts";
import * as fs from "fs";

vi.mock("../../../src/inference/provider.ts", () => ({
  createProvider: vi.fn(),
  getToolsForLLM: vi.fn(),
  getDefaultModel: vi.fn()
}));

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn()
}));

describe("ExecuteStep", () => {
  let step: ExecuteStep;
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
      { name: "edit_file", description: "Edit a file", parameters: {} }
    ]);
    
    (fs.readFileSync as any).mockReturnValue("function add(a, b) { return a - b; }");

    deps = {
      model: "test-model",
      maxIterations: 5,
      executeTool: vi.fn().mockResolvedValue({ success: true })
    };
    
    step = new ExecuteStep(deps);
    
    state = {
      repoUrl: "https://github.com/test/repo",
      repoPath: "/tmp/test-repo",
      issueText: "Fix bug",
      currentStep: "EXECUTE",
      fixPlan: "Use edit_file to fix math.ts",
      history: [],
      visitedFiles: ["src/math.ts"],
      errorLogs: []
    } as any;
  });

  it("applies changes using tools and transitions to VERIFY", async () => {
    mockProvider.complete
      .mockResolvedValueOnce({
        content: "I will fix it",
        toolCalls: [{ name: "edit_file", arguments: { filePath: "src/math.ts", oldSnippet: "-", newSnippet: "+" } }]
      })
      .mockResolvedValueOnce({
        content: "Done",
        toolCalls: undefined
      });

    const result = await step.execute(state);
    
    expect(result.nextStep).toBe("VERIFY");
    expect(deps.executeTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "edit_file" }),
      expect.any(Object)
    );
    expect(state.history.some(h => h.action === "Applied fixes")).toBe(true);
  });

  it("performs fuzzy matching if exact match fails", async () => {
    mockProvider.complete
      .mockResolvedValueOnce({
        content: "I will fix it",
        toolCalls: [{ name: "edit_file", arguments: { filePath: "src/math.ts", oldSnippet: "return a-b", newSnippet: "return a+b" } }]
      })
      .mockResolvedValueOnce({
        content: "Done",
        toolCalls: undefined
      });

    // Content is "function add(a, b) { return a - b; }"
    // oldSnippet "return a-b" (no spaces) should match "return a - b" fuzzy

    const result = await step.execute(state);
    
    expect(result.nextStep).toBe("VERIFY");
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(state.history.some(h => h.action === "Applied fixes")).toBe(true);
  });

  it("backtracks to PLAN if no changes were applied", async () => {
    mockProvider.complete.mockResolvedValue({
      content: "I can't fix it",
      toolCalls: undefined
    });

    const result = await step.execute(state);
    
    expect(result.nextStep).toBe("PLAN");
  });
});
