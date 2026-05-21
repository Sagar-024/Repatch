import { describe, it, expect } from "vitest";
import { createInitialState } from "../../src/orchestrator/state.js";

describe("orchestrator/state", () => {
  it("creates initial state with correct defaults", () => {
    const state = createInitialState(
      "https://github.com/owner/repo",
      "https://github.com/owner/repo/issues/1",
      "Bug description",
      "/tmp/repo"
    );

    expect(state.currentStep).toBe("UNDERSTAND");
    expect(state.repoUrl).toBe("https://github.com/owner/repo");
    expect(state.visitedFiles).toEqual([]);
    expect(state.errorLogs).toEqual([]);
    expect(state.history).toEqual([]);
  });
});
