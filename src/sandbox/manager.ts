// Sandbox Manager - Orchestrates Nixpacks -> Docker flow
import { getBuildPlan, generateDockerfile } from "./nixpacks.js";
import { buildImage, runInContainer, removeImage } from "./docker.js";

export interface SandboxConfig {
  repoPath: string;
  imageTag: string;
}

export interface SandboxState {
  imageTag: string;
  isBuilt: boolean;
  containerId?: string;
}

/**
 * Orchestrate the full sandbox flow:
 * 1. Run nixpacks plan to detect environment
 * 2. Generate Dockerfile
 * 3. Build Docker image
 * 4. Ready for command execution
 */
export class SandboxManager {
  private config: SandboxConfig;
  private state: SandboxState;

  constructor(repoPath: string, imageTag: string = "pr-fixer-sandbox:latest") {
    this.config = {
      repoPath,
      imageTag
    };
    this.state = {
      imageTag,
      isBuilt: false
    };
  }

  /**
   * Build the sandbox environment
   */
  async build(): Promise<void> {
    console.log(`   Detecting environment...`);
    const plan = await getBuildPlan(this.config.repoPath);
    console.log(`   Builder: ${plan.builder}, Language: ${plan.language}`);

    console.log(`   Generating Dockerfile...`);
    const dockerfile = await generateDockerfile(this.config.repoPath);

    console.log(`   Building Docker image: ${this.config.imageTag}`);
    await buildImage(dockerfile, this.config.imageTag);

    this.state.isBuilt = true;
  }

  /**
   * Run a command in the sandbox
   */
  async run(cmd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.state.isBuilt) {
      throw new Error("Sandbox not built. Call build() first.");
    }

    return runInContainer(this.config.imageTag, cmd);
  }

  /**
   * Cleanup resources
   */
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

/**
 * Convenience function to create and build a sandbox
 */
export async function createSandbox(repoPath: string): Promise<SandboxManager> {
  const manager = new SandboxManager(repoPath);
  await manager.build();
  return manager;
}