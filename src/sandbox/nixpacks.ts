import { execa } from "execa";
import * as fs from "fs";
import * as path from "path";

export interface NixpacksPlan {
  builder: string;
  language: string;
  version: string;
  installCmd: string[];
  startCmd: string[];
  pkgs?: string[];
}

/**
 * Run nixpacks plan to detect the language and build environment
 * Returns a JSON summary of the detected environment
 */
export async function getBuildPlan(repoPath: string): Promise<NixpacksPlan> {
  // First check if nixpacks is available
  const available = await isNixpacksAvailable();
  if (!available) {
    console.warn(`   ⚠️ Nixpacks not available. Using fallback detection.`);
    return detectFallback(repoPath);
  }

  try {
    // Run nixpacks plan with JSON output
    const { stdout, stderr } = await execa("nixpacks", ["plan", "--json"], {
      cwd: repoPath,
      reject: false
    });

    // Parse JSON output from stdout or combine with stderr
    const output = stdout || stderr;

    // Try to find JSON in output
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return detectFallback(repoPath);
    }

    const plan = JSON.parse(jsonMatch[0]);

    // Normalize the response to our interface
    return {
      builder: plan.builder || plan.Build?.builder || "unknown",
      language: plan.language || plan.Build?.language || "unknown",
      version: plan.version || plan.Build?.version || "latest",
      installCmd: plan.install_cmd || plan.Build?.install_cmd || [],
      startCmd: plan.start_cmd || plan.Build?.start_cmd || [],
      pkgs: plan.pkgs || plan.Build?.pkgs || []
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`   ⚠️ Nixpacks detection failed: ${errorMessage}. Using fallback.`);
    return detectFallback(repoPath);
  }
}

/**
 * Fallback detection when nixpacks is not available
 */
function detectFallback(repoPath: string): NixpacksPlan {
  // Check for package.json
  const packageJsonPath = path.join(repoPath, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    return {
      builder: "node",
      language: "node",
      version: "20",
      installCmd: ["npm install"],
      startCmd: ["npm test"]
    };
  }

  // Check for requirements.txt
  const reqPath = path.join(repoPath, "requirements.txt");
  if (fs.existsSync(reqPath)) {
    return {
      builder: "python",
      language: "python",
      version: "3",
      installCmd: ["pip install -r requirements.txt"],
      startCmd: ["python -m pytest"]
    };
  }

  // Check for go.mod
  const goModPath = path.join(repoPath, "go.mod");
  if (fs.existsSync(goModPath)) {
    return {
      builder: "go",
      language: "go",
      version: "latest",
      installCmd: ["go mod download"],
      startCmd: ["go test ./..."]
    };
  }

  // Default fallback
  return {
    builder: "node",
    language: "unknown",
    version: "latest",
    installCmd: [],
    startCmd: ["ls"]
  };
}

/**
 * Generate a Dockerfile from the nixpacks build
 * Returns the Dockerfile content
 */
export async function generateDockerfile(repoPath: string): Promise<string> {
  try {
    // Use nixpacks to generate a Dockerfile
    const { stdout } = await execa("nixpacks", ["build", "-o", "-"], {
      cwd: repoPath,
      reject: false
    });

    return stdout;
  } catch (error: unknown) {
    // If nixpacks fails, return a fallback Dockerfile
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`Nixpacks build generation failed: ${errorMessage}. Using fallback.`);

    return fallbackDockerfile();
  }
}

/**
 * Fallback Dockerfile for when nixpacks can't detect the environment
 */
function fallbackDockerfile(): string {
  return `FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["npm", "test"]`;
}

/**
 * Check if nixpacks is available on the system
 */
export async function isNixpacksAvailable(): Promise<boolean> {
  try {
    await execa("nixpacks", ["--version"]);
    return true;
  } catch {
    return false;
  }
}