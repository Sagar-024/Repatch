// Shell tool: run_command (executes in Docker)
import { runInContainer, CommandResult } from "../sandbox/docker.js";

// Allowlist of safe commands
const ALLOWED_COMMANDS = [
  "ls", "cat", "head", "tail", "grep", "find", "echo", "pwd",
  "npm", "yarn", "pnpm", "node", "python", "python3", "pip", "pip3",
  "go", "cargo", "rustc", "make", "gcc", "g++",
  "git", "git status", "git log",
  "npm test", "npm run", "yarn test", "yarn run",
  "python -m pytest", "pytest", "go test", "cargo test",
  "npm install", "yarn install", "pip install", "go get",
  "curl" // Only for localhost or known safe URLs
];

// Blocked commands for security
const BLOCKED_COMMANDS = [
  "rm -rf /", "rm -rf /*", "dd if=", ":(){:|:&};:",
  "wget.*-O", "curl.*sh", "chmod 777", "chown -R",
  "nc ", "netcat", "ssh ", "scp ",
  "mysql", "psql", "mongod"
];

interface RunCommandOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
}

/** @deprecated Use runInContainer from sandbox/docker directly */
export async function runCommand(
  imageTag: string,
  cmd: string,
  options: RunCommandOptions = {}
): Promise<CommandResult> {
  return runInContainer(imageTag, cmd);
}

export function validateCommand(cmd: string): { valid: boolean; reason?: string } {
  const lowerCmd = cmd.toLowerCase();

  // Check blocked commands
  for (const blocked of BLOCKED_COMMANDS) {
    if (lowerCmd.includes(blocked.toLowerCase())) {
      return {
        valid: false,
        reason: `Command contains blocked pattern: ${blocked}`
      };
    }
  }

  // Check allowlist
  const allowed = ALLOWED_COMMANDS.some(allowed => {
    if (allowed.includes(" ")) {
      // Multi-word command like "npm test"
      return cmd.startsWith(allowed);
    }
    return cmd.startsWith(allowed) || cmd.includes(` ${allowed} `);
  });

  if (!allowed) {
    return {
      valid: false,
      reason: "Command not in allowlist"
    };
  }

  return { valid: true };
}

export function buildEnvVars(env: Record<string, string> = {}): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}