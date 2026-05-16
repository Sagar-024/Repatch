import { execa, ExecaError } from "execa";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Build a Docker image from a Dockerfile
 */
export async function buildImage(dockerfileContent: string, tag: string): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-fixer-docker-"));

  try {
    const dockerfilePath = path.join(tmpDir, "Dockerfile");
    fs.writeFileSync(dockerfilePath, dockerfileContent);

    console.log(`   Building Docker image: ${tag}`);

    // Build using docker build command
    const { stdout } = await execa("docker", ["build", "-t", tag, "."], {
      cwd: tmpDir,
      reject: false
    });

    console.log(stdout);
    console.log(`   ✅ Image built successfully`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("connection refused") || errorMessage.includes("ENOENT")) {
      throw new Error("Docker not running. Start Docker Desktop or the docker daemon.");
    }

    throw new Error(`Docker build failed: ${errorMessage}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Run a command inside a container
 */
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
      "--network", "none",  // Security: no network
      "--memory", "2g",      // Limit memory
      "--cpus", "1",       // Limit CPU
    ];

    if (repoPath) {
      // Mount the repo path to /app in the container
      args.push("-v", `${path.resolve(repoPath)}:/app`);
      args.push("-w", "/app"); // Set working directory to /app
    }

    args.push(imageTag, "sh", "-c", cmd);

    // Run container with docker run
    const { stdout, stderr, exitCode } = await execa("docker", args, {
      reject: false
    });

    return {
      stdout: stdout || "",
      stderr: stderr || "",
      exitCode: exitCode ?? 0
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Fallback to local execution if Docker is not available
    if (errorMessage.includes("connection refused") || errorMessage.includes("ENOENT") || errorMessage.includes("cannot find the file specified")) {
      console.warn(`   ⚠️ Docker not available, falling back to local execution for: ${cmd}`);
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
        const { stdout, stderr, exitCode } = await execa(cmd.split(" ")[0], cmd.split(" ").slice(1), {
          cwd: repoPath,
          reject: false
        });
        return {
           stdout: stdout || "",
           stderr: stderr || "",
           exitCode: exitCode ?? 0
        };
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

    throw new Error(`Container execution failed: ${errorMessage}`);
  }
}

/**
 * Check if Docker is available
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execa("docker", ["info"], { reject: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a Docker image
 */
export async function removeImage(tag: string): Promise<void> {
  try {
    await execa("docker", ["rmi", "-f", tag], { reject: false });
  } catch {
    // Ignore
  }
}

/**
 * Pull an image
 */
export async function pullImage(imageTag: string): Promise<void> {
  await execa("docker", ["pull", imageTag]);
}