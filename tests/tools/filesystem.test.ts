import { describe, it, expect, vi } from "vitest";
import { listFiles, readFile, editFile } from "../../src/tools/filesystem.js";
import * as fs from "fs";
import * as path from "path";

vi.mock("fs", () => ({
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn()
}));

describe("tools/filesystem", () => {
  describe("listFiles", () => {
    it("lists files recursively", () => {
      (fs.readdirSync as any).mockImplementation((dir: string) => {
        if (dir === "/root") return [
          { name: "src", isDirectory: () => true },
          { name: "README.md", isDirectory: () => false }
        ];
        if (dir.includes("src")) return [
          { name: "index.ts", isDirectory: () => false }
        ];
        return [];
      });

      const files = listFiles("/root");
      expect(files).toHaveLength(2);
      expect(files.some(f => f.includes("index.ts"))).toBe(true);
      expect(files.some(f => f.includes("README.md"))).toBe(true);
    });
  });

  describe("readFile", () => {
    it("reads file with line numbers", () => {
      (fs.readFileSync as any).mockReturnValue("line1\nline2");
      const result = readFile("test.ts");
      expect(result.content).toBe("1: line1\n2: line2");
    });
  });

  describe("editFile", () => {
    it("replaces snippet in file", () => {
      (fs.readFileSync as any).mockReturnValue("function add(a, b) { return a - b; }");
      const result = editFile("math.ts", "a - b", "a + b");
      expect(result.success).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalledWith("math.ts", "function add(a, b) { return a + b; }", "utf-8");
    });

    it("fails if snippet not found", () => {
      (fs.readFileSync as any).mockReturnValue("content");
      const result = editFile("test.ts", "missing", "new");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Snippet not found");
    });
  });
});
