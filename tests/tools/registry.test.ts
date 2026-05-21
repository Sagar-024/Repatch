import { describe, it, expect } from "vitest";
import { getTool, getAllTools } from "../../src/tools/registry.js";

describe("tools/registry", () => {
  it("returns all tools", () => {
    const tools = getAllTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some(t => t.name === "read_file")).toBe(true);
  });

  it("gets a specific tool by name", () => {
    const tool = getTool("read_file");
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("read_file");
  });

  it("returns undefined for unknown tool", () => {
    const tool = getTool("unknown");
    expect(tool).toBeUndefined();
  });
});
