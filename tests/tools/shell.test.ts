import { describe, it, expect } from "vitest";
import { validateCommand, buildEnvVars } from "../../src/tools/shell.js";

describe("tools/shell", () => {
  describe("validateCommand", () => {
    it("allows safe commands", () => {
      expect(validateCommand("npm test").valid).toBe(true);
      expect(validateCommand("ls -la").valid).toBe(true);
      expect(validateCommand("cat README.md").valid).toBe(true);
    });

    it("blocks dangerous commands", () => {
      expect(validateCommand("rm -rf /").valid).toBe(false);
      expect(validateCommand("chmod 777 script.sh").valid).toBe(false);
    });

    it("blocks unknown commands", () => {
      expect(validateCommand("unknown-binary").valid).toBe(false);
    });
  });

  describe("buildEnvVars", () => {
    it("builds a string of env vars", () => {
      const env = { KEY1: "VAL1", KEY2: "VAL2" };
      expect(buildEnvVars(env)).toBe("KEY1=VAL1 KEY2=VAL2");
    });
  });
});
