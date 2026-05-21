import { describe, it, expect } from "vitest";
import { ConfigSchema } from "../../src/config/schema.js";

describe("config/schema", () => {
  it("validates empty config with defaults", () => {
    const result = ConfigSchema.parse({});
    expect(result.model).toBe("gemini-3.1-flash-lite");
    expect(result.sandbox.memory).toBe("2g");
  });

  it("accepts custom config", () => {
    const custom = { model: "gpt-4", openai: { apiKey: "test" } };
    const result = ConfigSchema.parse(custom);
    expect(result.model).toBe("gpt-4");
    expect(result.openai.apiKey).toBe("test");
  });
});
