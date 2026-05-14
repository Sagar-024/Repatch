import * as fs from "fs";
import * as path from "path";

/**
 * Generates a compressed file tree string for the repository.
 * Skips common ignored directories.
 */
export function generateFileTree(dir: string, depth = 0, maxDepth = 4): string {
  if (depth > maxDepth) return "";
  
  const ignore = [
    "node_modules",
    ".git",
    "dist",
    "build",
    "target",
    ".next",
    ".repatch",
    ".claude",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml"
  ];

  let tree = "";
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (ignore.includes(file)) continue;
      
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);
      
      const indent = "  ".repeat(depth);
      if (stats.isDirectory()) {
        tree += `${indent}📁 ${file}/\n`;
        tree += generateFileTree(filePath, depth + 1, maxDepth);
      } else {
        tree += `${indent}📄 ${file}\n`;
      }
    }
  } catch (err) {
    // Skip unreadable dirs
  }
  return tree;
}
