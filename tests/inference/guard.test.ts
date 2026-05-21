import { describe, it, expect } from "vitest";
import { validateToolCall, sanitizeToolCall } from "../../src/inference/guard.js";

describe("inference/guard", () => {
  const schema = {
    type: "object",
    properties: {
      filePath: { type: "string" },
      content: { type: "string" }
    },
    required: ["filePath", "content"]
  };

  it("validates correct tool calls", () => {
    const toolCall = { name: "write_file", arguments: { filePath: "test.ts", content: "hi" } };
    const result = validateToolCall(toolCall, schema);
    expect(result.valid).toBe(true);
  });

  it("fails if required parameter is missing", () => {
    const toolCall = { name: "write_file", arguments: { filePath: "test.ts" } };
    const result = validateToolCall(toolCall as any, schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required parameter: content");
  });

  it("sanitizes unexpected properties", () => {
    const toolCall = { name: "write_file", arguments: { filePath: "test.ts", content: "hi", extra: "evil" } };
    const sanitized = sanitizeToolCall(toolCall, schema);
    expect(sanitized.arguments.extra).toBeUndefined();
    expect(sanitized.arguments.filePath).toBe("test.ts");
  });
});
