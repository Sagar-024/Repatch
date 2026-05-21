import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExploreStep } from "../../../src/orchestrator/steps/explore.js";
import { AgentState } from "../../../src/orchestrator/state.js";
import * as provider from "../../../src/inference/provider.js";

vi.mock("../../../src/inference/provider.js", () => ({
  createProvider: vi.fn(),
  getToolsForLLM: vi.fn(),
  getDefaultModel: vi.fn()
}));

describe("ExploreStep", () => {
  let step: ExploreStep;
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
      { name: "grep_search", description: "Search", parameters: {} },
      { name: "read_file", description: "Read", parameters: {} }
    ]);
    
    deps = {
      model: "test-model",
      maxIterations: 5,
      executeTool: vi.fn().mockResolvedValue({ success: true, content: "file content" })
    };
    
    step = new ExploreStep(deps);
    
    state = {
      repoUrl: "https://github.com/test/repo",
      repoPath: "/tmp/test-repo",
      issueText: "Fix bug",
      currentStep: "EXPLORE",
      history: [{ step: "UNDERSTAND", result: '{"summary": "test bug"}' }],
      visitedFiles: [],
      errorLogs: []
    } as any;
  });

  it("explores and transitions to REPRODUCE", async () => {
    mockProvider.complete
      .mockResolvedValueOnce({
        content: "I will search",
        toolCalls: [{ name: "grep_search", arguments: { query: "bug" } }]
      })
      .mockResolvedValueOnce({
        content: "I will read",
        toolCalls: [{ name: "read_file", arguments: { filePath: "src/bug.ts" } }]
      })
      .mockResolvedValueOnce({
        content: "Done",
        toolCalls: undefined
      });

    // Mock executeTool to add file to visitedFiles when read_file is called
    deps.executeTool.mockImplementation((toolCall: any, state: any) => {
      if (toolCall.name === "read_file") {
        state.visitedFiles.push(toolCall.arguments.filePath);
      }
      return Promise.resolve({ success: true });
    });

    const result = await step.execute(state);
    
    expect(result.nextStep).toBe("REPRODUCE");
    expect(state.visitedFiles).toContain("src/bug.ts");
    expect(state.history.some(h => h.action === "Explored codebase")).toBe(true);
  });

  it("forces continuation if no files visited", async () => {
    mockProvider.complete
      .mockResolvedValueOnce({
        content: "I am thinking",
        toolCalls: undefined
      })
      .mockResolvedValueOnce({
        content: "Okay I will read",
        toolCalls: [{ name: "read_file", arguments: { filePath: "src/fix.ts" } }]
      })
      .mockResolvedValueOnce({
        content: "Done",
        toolCalls: undefined
      });

    deps.executeTool.mockImplementation((toolCall: any, state: any) => {
      if (toolCall.name === "read_file") {
        state.visitedFiles.push(toolCall.arguments.filePath);
      }
      return Promise.resolve({ success: true });
    });

    const result = await step.execute(state);
    
    expect(result.nextStep).toBe("REPRODUCE");
    expect(state.visitedFiles).toContain("src/fix.ts");
    expect(mockProvider.complete).toHaveBeenCalledTimes(3);
  });
});
