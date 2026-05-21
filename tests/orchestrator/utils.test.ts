import { describe, it, expect, vi } from "vitest";
import { generateFileTree } from "../../src/orchestrator/utils.js";
import * as fs from "fs";
import * as path from "path";

vi.mock("fs", () => ({
  readdirSync: vi.fn(),
  statSync: vi.fn()
}));

describe("orchestrator/utils", () => {
  describe("generateFileTree", () => {
    it("generates a tree string", () => {
      const root = path.resolve("/root");
      const src = path.resolve(root, "src");

      (fs.readdirSync as any).mockImplementation((dir: string) => {
        const d = path.resolve(dir);
        if (d === root) return ["src", "README.md", "node_modules"];
        if (d === src) return ["index.ts"];
        return [];
      });

      (fs.statSync as any).mockImplementation((filePath: string) => {
        const fp = path.resolve(filePath);
        return {
          isDirectory: () => fp === src || fp === root
        };
      });

      const tree = generateFileTree(root);
      expect(tree).toContain("📁 src/");
      expect(tree).toContain("  📄 index.ts");
      expect(tree).toContain("📄 README.md");
      expect(tree).not.toContain("node_modules");
    });
  });
});
