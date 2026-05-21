import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { loadConfig } from "../../src/config/loader.js";

describe("Config Loader Integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prfixer-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads default config when no file exists", () => {
    const config = loadConfig(tmpDir, {});
    expect(config.model).toBe("gemini-3.1-flash-lite");
    expect(config.sandbox.memory).toBe("2g");
  });

  it("loads config from YAML file", () => {
    const yamlContent = "model: gpt-4o\nsandbox:\n  memory: 4g";
    fs.writeFileSync(path.join(tmpDir, ".prfixer.yaml"), yamlContent);

    const config = loadConfig(tmpDir, {});
    expect(config.model).toBe("gpt-4o");
    expect(config.sandbox.memory).toBe("4g");
  });

  it("overrides YAML with environment variables", () => {
    const yamlContent = "model: gpt-4o";
    fs.writeFileSync(path.join(tmpDir, ".prfixer.yaml"), yamlContent);
    
    const env = {
      AI_MODEL: "claude-3-5-sonnet-latest",
      OPENAI_API_KEY: "test_key"
    };

    const config = loadConfig(tmpDir, env);
    expect(config.model).toBe("claude-3-5-sonnet-latest");
    expect(config.openai?.apiKey).toBe("test_key");
  });
});
