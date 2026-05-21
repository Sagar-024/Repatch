// Context engine - handles file reading and pruning for context
import * as fs from "fs";
import * as path from "path";

export interface FileContext {
  path: string;
  content: string;
  lineCount: number;
  language: string;
}

export function readFileContext(filePath: string): FileContext {
  const content = fs.readFileSync(filePath, "utf-8");
  const ext = path.extname(filePath);

  return {
    path: filePath,
    content,
    lineCount: content.split("\n").length,
    language: getLanguageFromExt(ext)
  };
}

export function readFilesContext(filePaths: string[]): FileContext[] {
  return filePaths.map(readFileContext);
}

export function pruneContext(files: FileContext[], maxTokens: number = 32000): FileContext[] {
  const result: FileContext[] = [];

  for (const file of files) {
    const estimatedTokens = file.lineCount * 1.5; // Rough estimate
    const remaining = maxTokens - result.reduce((acc, f) => acc + f.lineCount * 1.5, 0);

    if (estimatedTokens <= remaining) {
      result.push(file);
    } else {
      const maxLines = Math.floor(remaining / 1.5);
      result.push({
        ...file,
        content: file.content.split("\n").slice(0, maxLines).join("\n"),
        lineCount: maxLines
      });
    }
  }

  return result;
}

function getLanguageFromExt(ext: string): string {
  const extMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".rb": "ruby",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".md": "markdown",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml"
  };

  return extMap[ext] || "unknown";
}

export function listFiles(dirPath: string, exclude: string[] = ["node_modules", ".git", "dist"]): string[] {
  const files: string[] = [];

  function traverse(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (exclude.includes(entry.name)) continue;

      if (entry.isDirectory()) {
        traverse(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }

  traverse(dirPath);
  return files;
}