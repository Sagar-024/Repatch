import { describe, it, expect, vi, beforeEach } from "vitest";
import { SandboxManager } from "../../src/sandbox/manager.js";
import * as nixpacks from "../../src/sandbox/nixpacks.js";
import * as docker from "../../src/sandbox/docker.js";

vi.mock("../../src/sandbox/nixpacks.js", () => ({
  getBuildPlan: vi.fn().mockResolvedValue({ builder: "node", language: "javascript" }),
  generateDockerfile: vi.fn().mockResolvedValue("FROM node:20")
}));

vi.mock("../../src/sandbox/docker.js", () => ({
  buildImage: vi.fn().mockResolvedValue(undefined),
  runInContainer: vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 }),
  removeImage: vi.fn().mockResolvedValue(undefined)
}));

describe("sandbox/manager", () => {
  let manager: SandboxManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SandboxManager("/tmp/repo", "test-tag");
  });

  it("builds the sandbox", async () => {
    await manager.build();
    expect(nixpacks.getBuildPlan).toHaveBeenCalled();
    expect(docker.buildImage).toHaveBeenCalled();
    expect(manager.isReady()).toBe(true);
  });

  it("runs commands after build", async () => {
    await manager.build();
    const result = await manager.run("npm test");
    expect(docker.runInContainer).toHaveBeenCalledWith("test-tag", "npm test", "/tmp/repo");
    expect(result.stdout).toBe("ok");
  });

  it("throws if run before build", async () => {
    await expect(manager.run("npm test")).rejects.toThrow("Sandbox not built");
  });
});
