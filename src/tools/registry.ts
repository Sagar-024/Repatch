// Tool registration and schema exports

import { listFiles, readFile, grepSearch, FileResult, GrepResult, editFile, createReproductionTest } from "./filesystem.js";

import { runInContainer, CommandResult } from "../sandbox/docker.js";
import * as fs from "fs";
import * as path from "path";

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<any>;
}

async function writeFile(args: { filePath: string; content: string }): Promise<{ success: boolean; path: string }> {
  const { filePath, content } = args;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, "utf-8");
  return { success: true, path: filePath };
}

export const tools: Tool[] = [
  {
    name: "list_files",
    description: "List files in a directory recursively",
    parameters: {
      type: "object",
      properties: {
        dirPath: { type: "string" },
        pattern: { type: "string" }
      },
      required: ["dirPath"]
    },
    handler: async (args: { dirPath: string; pattern?: string }) => listFiles(args.dirPath, args.pattern)
  },
  {
    name: "read_file",
    description: "Read a file and return its content with line numbers",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string" }
      },
      required: ["filePath"]
    },
    handler: async (args: { filePath: string }): Promise<FileResult> => readFile(args.filePath)
  },
  {
    name: "grep_search",
    description: "Search for a pattern in files",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        dirPath: { type: "string" },
        extensions: { type: "array", items: { type: "string" } }
      },
      required: ["pattern", "dirPath"]
    },
    handler: async (args: { pattern: string; dirPath: string; extensions?: string[] }): Promise<GrepResult[]> =>
      grepSearch(args.pattern, args.dirPath, args.extensions)
  },
  {
    name: "run_command",
    description: "Run a command inside a sandboxed Docker container",
    parameters: {
      type: "object",
      properties: {
        imageTag: { type: "string", description: "The Docker image tag to use" },
        cmd: { type: "string", description: "The command to run inside the container" },
        repoPath: { type: "string", description: "The host path to mount into the container" }
      },
      required: ["imageTag", "cmd"]
    },
    handler: async (args: { imageTag: string; cmd: string; repoPath?: string }): Promise<CommandResult> =>
      runInContainer(args.imageTag, args.cmd, args.repoPath)
  },

  {
    name: "write_file",
    description: "Write content to a file (creates or overwrites)",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        content: { type: "string" }
      },
      required: ["filePath", "content"]
    },
    handler: async (args: { filePath: string; content: string }): Promise<{ success: boolean; path: string }> =>
      writeFile(args)
  },
  {
    name: "edit_file",
    description: "Surgically replace a snippet of code in a file. Requires an exact match of the old snippet.",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        oldSnippet: { type: "string", description: "The exact code snippet to be replaced" },
        newSnippet: { type: "string", description: "The new code snippet to insert" }
      },
      required: ["filePath", "oldSnippet", "newSnippet"]
    },
    handler: async (args: { filePath: string; oldSnippet: string; newSnippet: string }) =>
      editFile(args.filePath, args.oldSnippet, args.newSnippet)
  },
  {
    name: "create_reproduction_test",
    description: "Create a dedicated reproduction test file to prove a bug exists.",
    parameters: {
      type: "object",
      properties: {
        dirPath: { type: "string", description: "The directory to create the test in" },
        content: { type: "string", description: "The full content of the test file" },
        fileName: { type: "string", description: "The name of the test file (default: reproduce.test.ts)" }
      },
      required: ["dirPath", "content"]
    },
    handler: async (args: { dirPath: string; content: string; fileName?: string }) =>
      createReproductionTest(args.dirPath, args.content, args.fileName)
  }
];


export function getTool(name: string): Tool | undefined {
  return tools.find(t => t.name === name);
}

export function getAllTools(): Tool[] {
  return tools;
}

export function getToolSchema(name: string): Record<string, unknown> | undefined {
  const tool = getTool(name);
  return tool?.parameters;
}