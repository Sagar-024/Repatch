import { execa, ExecaError } from "execa";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { config } from "../config/loader.js";
import { logger } from "../utils/logger.js";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function buildImage(dockerfileContent: string, tag: string): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-fixer-docker-"));

  try {
    const dockerfilePath = path.join(tmpDir, "Dockerfile");
    fs.writeFileSync(dockerfilePath, dockerfileContent);

    logger.debug(`Building Docker image: ${tag}`);

    const { stdout, stderr, exitCode } = await execa("docker", ["build", "-t", tag, "."], {
      cwd: tmpDir,
      reject: false
    });

    if (exitCode !== 0) {
      if (stderr.includes("connection refused") || stderr.includes("daemon is not running") || stderr.includes("cannot find the file specified")) {
         throw new Error("Docker not running. Start Docker Desktop or the docker daemon.");
      }
      throw new Error(`Docker build failed with exit code ${exitCode}: ${stderr || stdout}`);
    }

    logger.debug(stdout);
    logger.debug(`Image built successfully: ${tag}`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("connection refused") || errorMessage.includes("ENOENT") || errorMessage.includes("daemon is not running")) {
      throw new Error("Docker not running. Start Docker Desktop or the docker daemon.");
    }

    throw new Error(`Docker build failed: ${errorMessage}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function runInContainer(imageTag: string, cmd: string, repoPath?: string): Promise<CommandResult> {
  try {
    // Pull image first if needed
    try {
      await execa("docker", ["pull", imageTag], { reject: false });
    } catch {
      // Continue even if pull fails - image might exist locally
    }

    const args = [
      "run",
      "--rm",
    ];

    if (!config.sandbox.network) {
      args.push("--network", "none");
    }

    if (config.sandbox.memory) {
      args.push("--memory", config.sandbox.memory);
    }

    if (config.sandbox.cpus) {
      args.push("--cpus", config.sandbox.cpus.toString());
    }

    if (repoPath) {
      // Mount the repo path to /app in the container
      args.push("-v", `${path.resolve(repoPath)}:/app`);
      args.push("-w", "/app"); // Set working directory to /app
    }

    args.push(imageTag, "sh", "-c", cmd);

    logger.debug(`Running in container: ${cmd}`);

    // Run container with docker run
    const { stdout, stderr, exitCode } = await execa("docker", args, {
      reject: false
    });

    if (exitCode !== 0 && (stderr.includes("connection refused") || stderr.includes("daemon is not running") || stderr.includes("cannot find the file specified"))) {
       throw new Error(`Docker connection failed: ${stderr}`);
    }

    return {
      stdout: stdout || "",
      stderr: stderr || "",
      exitCode: exitCode ?? 0
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Fallback to local execution if Docker is not available
    if (errorMessage.includes("connection refused") || errorMessage.includes("ENOENT") || errorMessage.includes("cannot find the file specified") || errorMessage.includes("daemon is not running")) {
      logger.warn(`Docker not available, falling back to local execution for: ${cmd}`);
      try {
        const { stdout, stderr, exitCode } = await execa("sh", ["-c", cmd], {
          cwd: repoPath,
          reject: false
        });
        return {
          stdout: stdout || "",
          stderr: stderr || "",
          exitCode: exitCode ?? 0
        };
      } catch (localError) {
        // If sh -c fails (e.g. on Windows without sh), try running the command directly
        try {
          const { stdout, stderr, exitCode } = await execa(cmd.split(" ")[0], cmd.split(" ").slice(1), {
            cwd: repoPath,
            reject: false
          });
          return {
             stdout: stdout || "",
             stderr: stderr || "",
             exitCode: exitCode ?? 0
          };
        } catch (finalError) {
          return {
            stdout: "",
            stderr: String(finalError),
            exitCode: 1
          };
        }
      }
    }

    // Check for ExecaError which has exitCode property
    if (error instanceof ExecaError) {
      return {
        stdout: error.stdout || "",
        stderr: error.stderr || "",
        exitCode: error.exitCode ?? 1
      };
    }

    return {
      stdout: "",
      stderr: errorMessage,
      exitCode: 1
    };
  }
}

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execa("docker", ["info"], { reject: false });
    return true;
  } catch {
    return false;
  }
}

export async function removeImage(tag: string): Promise<void> {
  try {
    await execa("docker", ["rmi", "-f", tag], { reject: false });
  } catch {
    // Ignore
  }
}

export async function pullImage(imageTag: string): Promise<void> {
  await execa("docker", ["pull", imageTag]);
}
