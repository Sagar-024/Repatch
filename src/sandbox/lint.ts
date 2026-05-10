import * as fs from "fs";
import * as path from "path";

/**
 * Detect the auto-formatter command for a given repository
 */
export function detectFormatCommand(repoPath: string): string | null {
  const packageJsonPath = path.join(repoPath, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      if (pkg.scripts) {
        if (pkg.scripts.format) return "npm run format";
        if (pkg.scripts.fix) return "npm run fix";
      }
    } catch { /* ignore */ }
  }

  const formatFiles: Record<string, string> = {
    ".prettierrc": "npx prettier --write .",
    "pyproject.toml": "black .",
    "ruff.toml": "ruff format .",
    ".rustfmt.toml": "cargo fmt",
    "go.mod": "go fmt ./...",
  };

  for (const [file, cmd] of Object.entries(formatFiles)) {
    if (fs.existsSync(path.join(repoPath, file))) {
      return cmd;
    }
  }

  return null;
}

/**
 * Detect the linter or formatter command for a given repository
 */
export function detectLintCommand(repoPath: string): string | null {
  // 1. Check package.json for scripts
  const packageJsonPath = path.join(repoPath, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      if (pkg.scripts) {
        if (pkg.scripts.lint) return "npm run lint";
        if (pkg.scripts.format) return "npm run format";
        if (pkg.scripts.check) return "npm run check";
      }
    } catch {
      // Ignore parse errors
    }
  }

  // 2. Check for common config files and return default commands
  const configFiles: Record<string, string> = {
    ".eslintrc": "npx eslint .",
    ".eslintrc.js": "npx eslint .",
    ".eslintrc.json": "npx eslint .",
    ".prettierrc": "npx prettier --check .",
    "ruff.toml": "ruff check .",
    ".ruff.toml": "ruff check .",
    "pyproject.toml": "ruff check .", // Often used for ruff/black
  };

  for (const [file, cmd] of Object.entries(configFiles)) {
    if (fs.existsSync(path.join(repoPath, file))) {
      return cmd;
    }
  }

  return null;
}
