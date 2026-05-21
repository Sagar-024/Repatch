// Sandbox Manager - Orchestrates Nixpacks -> Docker flow
import { getBuildPlan, generateDockerfile } from "./nixpacks.js";
import { buildImage, runInContainer, removeImage } from "./docker.js";
import { logger } from "../utils/logger.js";
import { execa } from "execa";

export interface SandboxConfig {
  repoPath: string;
  imageTag: string;
  isLocal?: boolean;
}

export interface SandboxState {
  imageTag: string;
  isBuilt: boolean;
  containerId?: string;
  isLocal: boolean;
}

export class SandboxManager {
  private config: SandboxConfig;
  private state: SandboxState;

  constructor(repoPath: string, imageTag: string = "repatch-sandbox:latest", isLocal = false) {
    this.config = {
      repoPath,
      imageTag,
      isLocal
    };
    this.state = {
      imageTag,
      isBuilt: isLocal, // If local, we consider it "built" (ready) immediately
      isLocal
    };
  }

  async build(): Promise<void> {
    if (this.config.isLocal) {
      logger.info("Local execution enabled. Skipping Docker build.");
      return;
    }

    console.log(`   Detecting environment...`);
    const plan = await getBuildPlan(this.config.repoPath);
    console.log(`   Builder: ${plan.builder}, Language: ${plan.language}`);

    console.log(`   Generating Dockerfile...`);
    const dockerfile = await generateDockerfile(this.config.repoPath);

    console.log(`   Building Docker image: ${this.config.imageTag}`);
    await buildImage(dockerfile, this.config.imageTag);

    this.state.isBuilt = true;
  }

  async run(cmd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.state.isBuilt && !this.state.isLocal) {
      throw new Error("Sandbox not built. Call build() first.");
    }

    if (this.state.isLocal) {
      logger.debug(`Running locally: ${cmd}`);
      try {
        // Use powershell on Windows for shell commands if 'sh' is missing
        const shell = process.platform === "win32" ? "powershell.exe" : "sh";
        const shellArgs = process.platform === "win32" ? ["-Command", cmd] : ["-c", cmd];

        const { stdout, stderr, exitCode } = await execa(shell, shellArgs, {
          cwd: this.config.repoPath,
          reject: false,
          env: {
            ...process.env,
            CI: "true"
          }
        });
        return {
          stdout: stdout || "",
          stderr: stderr || "",
          exitCode: exitCode ?? 0
        };
      } catch (error: any) {
        return {
          stdout: "",
          stderr: error.message,
          exitCode: 1
        };
      }
    }

    return runInContainer(this.config.imageTag, cmd, this.config.repoPath);
  }

  async cleanup(): Promise<void> {
    await removeImage(this.config.imageTag);
    this.state.isBuilt = false;
  }

  getState(): SandboxState {
    return { ...this.state };
  }

  isReady(): boolean {
    return this.state.isBuilt;
  }
}

export async function createSandbox(repoPath: string): Promise<SandboxManager> {
  const manager = new SandboxManager(repoPath);
  await manager.build();
  return manager;
}