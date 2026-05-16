import { jest } from "@jest/globals";

// Mock the provider BEFORE any other imports that might use it
jest.unstable_mockModule("../../../src/inference/provider.js", () => ({
  createProvider: jest.fn(),
  getDefaultModel: jest.fn().mockReturnValue("test-model"),
  getToolsForLLM: jest.fn().mockReturnValue([]),
}));

// Now import the modules that use the mock
const { ReproduceStep } = await import("../../../src/orchestrator/steps/reproduce.js");
const { createInitialState } = await import("../../../src/orchestrator/state.js");
const { createProvider } = await import("../../../src/inference/provider.js");

describe("ReproduceStep", () => {
  let state: any;
  let deps: any;
  let mockProvider: any;

  beforeEach(() => {
    state = createInitialState("https://github.com/test/repo", "https://github.com/test/repo/issues/1", "Test issue", "/tmp/repo");
    state.fileTree = "src/index.ts\ntests/repro.test.ts";

    mockProvider = {
      complete: jest.fn()
    };
    (createProvider as any).mockReturnValue(mockProvider);

    deps = {
      model: "test-model",
      maxIterations: 2,
      executeTool: jest.fn() as any
    };
  });

  it("should attempt to reproduce the bug by creating a test and running it", async () => {
    const step = new ReproduceStep(deps);

    // Iteration 1: Agent decides to create a reproduction test
    mockProvider.complete
      .mockResolvedValueOnce({
        content: "I will create a reproduction test.",
        toolCalls: [
          {
            name: "create_reproduction_test",
            arguments: { dirPath: "/tmp/repo", content: "test content" }
          }
        ]
      })
      // Iteration 2: Agent runs the test
      .mockResolvedValueOnce({
        content: "Now I will run the test.",
        toolCalls: [
          {
            name: "run_command",
            arguments: { cmd: "npm test reproduce.test.ts" }
          }
        ]
      })
      // Iteration 3: Agent sees failure and is done
      .mockResolvedValueOnce({
        content: "Done.",
        toolCalls: []
      });

    (deps.executeTool as any).mockResolvedValueOnce({ success: true, path: "/tmp/repo/reproduce.test.ts" });
    (deps.executeTool as any).mockResolvedValueOnce({
      exitCode: 1,
      stdout: "Tests failed!",
      stderr: ""
    });

    const result = await step.execute(state);

    expect(result.nextStep).toBe("PLAN");
    expect(state.reproductionTest).toBe("npm test reproduce.test.ts");
    expect(deps.executeTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "create_reproduction_test" }),
      state
    );
  });


  it("should continue if the agent doesn't call any tool initially", async () => {
    const step = new ReproduceStep(deps);

    mockProvider.complete
      .mockResolvedValueOnce({
        content: "Thinking...",
        toolCalls: []
      })
      .mockResolvedValueOnce({
        content: "Running test...",
        toolCalls: [{ name: "run_command", arguments: { cmd: "ls" } }]
      });

    (deps.executeTool as any).mockResolvedValueOnce({ exitCode: 0, stdout: "ok", stderr: "" });

    await step.execute(state);

    expect(mockProvider.complete).toHaveBeenCalledTimes(2);
  });
});
