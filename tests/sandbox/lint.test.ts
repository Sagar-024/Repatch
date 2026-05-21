import { describe, it, expect, vi } from "vitest";
import { detectFormatCommand, detectLintCommand } from "../../src/sandbox/lint.js";
import * as fs from "fs";
import * as path from "path";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}));

describe("sandbox/lint", () => {
  const repoPath = "/tmp/repo";

  describe("detectFormatCommand", () => {
    it("detects npm format script", () => {
      (fs.existsSync as any).mockImplementation((p: string) => p.endsWith("package.json"));
      (fs.readFileSync as any).mockReturnValue(JSON.stringify({ scripts: { format: "prettier --write" } }));
      
      expect(detectFormatCommand(repoPath)).toBe("npm run format");
    });

    it("detects prettierrc", () => {
      (fs.existsSync as any).mockImplementation((p: string) => p.endsWith(".prettierrc"));
      
      expect(detectFormatCommand(repoPath)).toBe("npx prettier --write .");
    });
  });

  describe("detectLintCommand", () => {
    it("detects npm lint script", () => {
      (fs.existsSync as any).mockImplementation((p: string) => p.endsWith("package.json"));
      (fs.readFileSync as any).mockReturnValue(JSON.stringify({ scripts: { lint: "eslint" } }));
      
      expect(detectLintCommand(repoPath)).toBe("npm run lint");
    });

    it("detects eslintrc", () => {
      (fs.existsSync as any).mockImplementation((p: string) => p.endsWith(".eslintrc"));
      
      expect(detectLintCommand(repoPath)).toBe("npx eslint .");
    });
  });
});
