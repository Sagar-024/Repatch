// Filesystem tools: list_files, read_file, grep_search
import * as fs from "fs";
import * as path from "path";

export interface FileResult {
  path: string;
  content: string;
  lineCount: number;
}

export interface GrepResult {
  file: string;
  line: number;
  content: string;
}

/**
 * List files in a directory recursively
 */
export function listFiles(dirPath: string, pattern?: string): string[] {
  const files: string[] = [];

  function traverse(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
        continue;
      }

      if (entry.isDirectory()) {
        traverse(fullPath);
      } else {
        if (pattern) {
          if (new RegExp(pattern).test(entry.name)) {
            files.push(fullPath);
          }
        } else {
          files.push(fullPath);
        }
      }
    }
  }

  traverse(dirPath);
  return files;
}

/**
 * Read a file and return its content with line numbers
 */
export function readFile(filePath: string): FileResult {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  // Add line numbers
  const numberedContent = lines.map((line, i) => `${i + 1}: ${line}`).join("\n");

  return {
    path: filePath,
    content: numberedContent,
    lineCount: lines.length
  };
}

/**
 * Search for a pattern in files
 */
export function grepSearch(pattern: string, dirPath: string, extensions?: string[]): GrepResult[] {
  const results: GrepResult[] = [];
  const regex = new RegExp(pattern, "i"); // Remove 'g' flag for simple line-by-line matching

  const files = listFiles(dirPath);

  for (const file of files) {
    // Filter by extension if specified
    if (extensions && extensions.length > 0) {
      const ext = path.extname(file).slice(1);
      if (!extensions.includes(ext)) {
        continue;
      }
    }

    try {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push({
            file,
            line: i + 1,
            content: lines[i].trim()
          });
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return results;
}

/**
 * Surgical snippet replacement in a file
 */
export function editFile(filePath: string, oldSnippet: string, newSnippet: string): { success: boolean; error?: string } {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    
    // Exact match check
    const occurrences = content.split(oldSnippet).length - 1;
    
    if (occurrences === 0) {
      return { success: false, error: "Snippet not found in file. Ensure exact match including whitespace." };
    }
    
    if (occurrences > 1) {
      return { success: false, error: `Ambiguous match: found ${occurrences} occurrences of the snippet.` };
    }
    
    const newContent = content.replace(oldSnippet, newSnippet);
    fs.writeFileSync(filePath, newContent, "utf-8");
    
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: String(error) };
  }
}

/**
 * Check if a file exists
 */
export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Get file stats
 */
export function getFileStats(filePath: string): { size: number; modified: Date } | null {
  try {
    const stats = fs.statSync(filePath);
    return {
      size: stats.size,
      modified: stats.mtime
    };
  } catch {
    return null;
  }
}