import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { ConfigSchema, Config } from "./schema.js";
import { logger } from "../utils/logger.js";

export function loadConfig(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): Config {
  const configPaths = [
    path.join(cwd, ".repatch.yaml"),
    path.join(cwd, ".repatch.yml"),
    path.join(cwd, ".prfixer.yaml"),
    path.join(cwd, ".prfixer.yml"),
  ];

  let rawConfig: any = {};

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const fileContent = fs.readFileSync(configPath, "utf8");
        rawConfig = yaml.load(fileContent) || {};
        logger.debug(`Loaded config from ${configPath}`);
        break;
      } catch (error) {
        logger.warn(`Failed to parse config at ${configPath}: ${error}`);
      }
    }
  }

  // Override with environment variables
  const envConfig = {
    model: env.AI_MODEL || rawConfig.model,
    openai: {
      apiKey: env.OPENAI_API_KEY || rawConfig.openai?.apiKey,
      baseUrl: env.OPENAI_API_BASE || rawConfig.openai?.baseUrl,
    },
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY || rawConfig.anthropic?.apiKey,
    },
    gemini: {
      apiKey: env.GEMINI_API_KEY || rawConfig.gemini?.apiKey,
    },
    mimo: {
      apiKey: env.MIMO_API_KEY || rawConfig.mimo?.apiKey,
      baseUrl: env.MIMO_API_BASE || env.MIMO_BASE_URL || rawConfig.mimo?.baseUrl,
    },
    github: {
      token: env.GH_TOKEN || rawConfig.github?.token,
    },
  };

  const merged = { ...rawConfig, ...envConfig };
  
  const result = ConfigSchema.safeParse(merged);
  
  if (!result.success) {
    logger.error("Invalid configuration:");
    result.error.issues.forEach((err: any) => {
      logger.error(`  ${err.path.join(".")}: ${err.message}`);
    });
    return ConfigSchema.parse({}); // Fallback to defaults
  }

  return result.data;
}

export const config = loadConfig();
