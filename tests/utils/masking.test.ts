import { describe, it, expect } from "vitest";
import { maskSecrets, maskObject } from "../../src/utils/masking.js";

describe("utils/masking", () => {
  it("masks github tokens", () => {
    const text = "My token is ghp_1234567890abcdef1234567890abcdef1234 and it is secret.";
    expect(maskSecrets(text)).toBe("My token is [REDACTED] and it is secret.");
  });

  it("masks openai keys", () => {
    const text = "Key: sk-1234567890abcdef1234567890abcdef1234567890abcdef";
    expect(maskSecrets(text)).toBe("Key: [REDACTED]");
  });

  it("masks objects", () => {
    const obj = { token: "ghp_1234567890abcdef1234567890abcdef1234", nested: { key: "sk-1234567890abcdef1234567890abcdef1234567890abcdef" } };
    const masked = maskObject(obj);
    expect(masked.token).toBe("[REDACTED]");
    expect(masked.nested.key).toBe("[REDACTED]");
  });
});
