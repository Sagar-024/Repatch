#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import { cloneRepo } from "./adapters/git.js";
import { getBuildPlan, generateDockerfile } from "./sandbox/nixpacks.js";
import { buildImage, runInContainer } from "./sandbox/docker.js";
import { createProvider, getDefaultModel, getToolsForLLM, ToolCall, LLMMessage } from "./inference/provider.js";
import { getTool } from "./tools/registry.js";
import { logger } from "./utils/logger.js";
import * as path from "path";
import * as fs from "fs";

const program = new Command();

program
  .name("repatch")
  .description("Autonomous PR fixer - Junior Developer in a box")
  .version("0.1.0");

program
  .command("review <path>")
  .description("Run a security and code quality review on a file")
  .option("-m, --model <model>", "AI model to use", getDefaultModel())
  .action(async (filePath: string, options: { model: string }) => {
    const { ReviewAgent } = await import("./review-agent.js");
    const agent = new ReviewAgent(options.model);
    await agent.run(filePath);
  });

program
  .command("verify <url>")
  .description("Verify repo can be cloned and containerized (smoke test)")
  .action(async (url: string) => {
    logger.info(`Running smoke tests...`);

    const targetDir = path.resolve(process.cwd(), `.pr-fixer-${Date.now()}`);

    try {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }

    try {
      logger.start(`Test 1: Clone repo`);
      await cloneRepo(url, targetDir);
      logger.succeed(`Clone passed`);

      logger.start(`Test 2: Nixpacks detection`);
      const plan = await getBuildPlan(targetDir);
      logger.succeed(`Detection: ${plan.builder}`);

      logger.start(`Test 3: Docker sandbox`);
      const dockerfile = await generateDockerfile(targetDir);
      await buildImage(dockerfile, "pr-fixer-verify:latest");
      const result = await runInContainer("pr-fixer-verify:latest", "echo 'hello from container'");
      logger.succeed(`Container: ${result.stdout.trim()}`);

      logger.succeed(`All smoke tests passed!`);
    } catch (error) {
      logger.fail(`Smoke test failed: ${error}`);
      process.exit(1);
    } finally {
      try {
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  });

program
  .command("explore <path>")
  .description("Explore a codebase using the LLM with tool access")
  .option("-m, --model <model>", "AI model to use", getDefaultModel())
  .option("-q, --question <text>", "Question to ask about the codebase")
  .option("-i, --interactive", "Interactive REPL mode", false)
  .action(async (repoPath: string, options: { model: string; question?: string; interactive: boolean }) => {
    logger.info(`Code Exploration Mode`);
    logger.info(`Model: ${options.model}`);
    logger.info(`Path: ${path.resolve(repoPath)}`);

    const absPath = path.resolve(repoPath);

    if (!fs.existsSync(absPath)) {
      logger.fail(`Path does not exist: ${absPath}`);
      process.exit(1);
    }

    const provider = createProvider({ model: options.model });
    const tools = await getToolsForLLM();
    const toolContext = { repoPath: absPath };

    const systemPrompt = `You are a code exploration tool. You MUST use tools when the user asks you to explore.

REPO PATH: ${absPath}

When you need to use a tool, respond with ONLY this exact JSON format (no other text):
{"name": "tool_name", "arguments": {"param": "full path here"}}

Example - to list files in the project root:
{"name": "list_files", "arguments": {"dirPath": "${absPath}"}}

Example - to read package.json:
{"name": "read_file", "arguments": {"filePath": "${absPath}/package.json"}}

If you don't need a tool, answer directly. Never use relative paths like "package.json" - always use absolute paths starting with ${absPath}`;

    if (options.interactive) {
      await runInteractiveMode(provider, tools, systemPrompt, toolContext);
    } else if (options.question) {
      await runSingleQuery(provider, tools, systemPrompt, toolContext, options.question);
    } else {
      await runSingleQuery(
        provider,
        tools,
        systemPrompt,
        toolContext,
        "List the top-level files and directories in this project. Give me a brief summary of what this project is about."
      );
    }
  });

async function runSingleQuery(
  provider: any,
  tools: any[],
  systemPrompt: string,
  toolContext: { repoPath: string },
  question: string
): Promise<void> {
  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: question }
  ];

  logger.info(`Question: ${question}`);

  let response = await provider.complete(messages, tools);
  let iterations = 0;
  const maxIterations = 5;

  while (response.toolCalls && iterations < maxIterations) {
    messages.push({
      role: "assistant" as const,
      content: response.content || "",
      toolCalls: response.toolCalls
    });

    for (const toolCall of response.toolCalls) {
      logger.start(`Calling tool: ${toolCall.name}`);
      const result = await executeTool(toolCall, toolContext);
      logger.succeed(`Tool executed: ${toolCall.name}`);
      logger.debug(`Result: ${JSON.stringify(result).slice(0, 200)}...`);

      messages.push({
        role: "tool" as const,
        name: toolCall.name,
        toolCallId: toolCall.id,
        content: JSON.stringify(result)
      });
    }

    response = await provider.complete(messages, tools);
    iterations++;
  }

  logger.info(`Answer:\n${response.content}`);
}

async function runInteractiveMode(
  provider: any,
  tools: any[],
  systemPrompt: string,
  toolContext: { repoPath: string }
): Promise<void> {
  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt }
  ];

  logger.info(`Interactive mode. Type "exit" to quit.`);

  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const ask = (): void => {
    rl.question("> ", async (input) => {
      if (input.toLowerCase() === "exit") {
        rl.close();
        return;
      }

      messages.push({ role: "user", content: input });

      try {
        let response = await provider.complete(messages, tools);
        let iterations = 0;
        const maxIterations = 5;

        while (response.toolCalls && iterations < maxIterations) {
          messages.push({
            role: "assistant" as const,
            content: response.content || "",
            toolCalls: response.toolCalls
          });

          for (const toolCall of response.toolCalls) {
            logger.start(`Calling tool: ${toolCall.name}`);
            const result = await executeTool(toolCall, toolContext);
            logger.succeed(`Tool executed: ${toolCall.name}`);
            logger.debug(`Result: ${JSON.stringify(result).slice(0, 500)}`);

            messages.push({
              role: "tool" as const,
              name: toolCall.name,
              toolCallId: toolCall.id,
              content: JSON.stringify(result)
            });
          }

          response = await provider.complete(messages, tools);
          iterations++;
        }

        logger.log(`\n${response.content}\n`);
        messages.push({
          role: "assistant" as const,
          content: response.content || ""
        });
      } catch (error) {
        logger.fail(`Error: ${error}`);
      }

      ask();
    });
  };

  ask();
}

async function executeTool(toolCall: ToolCall, context: { repoPath: string }): Promise<unknown> {
  const tool = getTool(toolCall.name);
  if (!tool) {
    return { error: `Tool not found: ${toolCall.name}` };
  }

  const args: Record<string, unknown> = { ...toolCall.arguments };

  const normalizePath = (p: string): string => {
    if (p.startsWith("/C:/")) return p.slice(1);
    if (p.startsWith("/c/")) return "C:" + p.slice(2);
    return p;
  };

  if (toolCall.name === "list_files" || toolCall.name === "grep_search") {
    const dirPath = args.dirPath as string | undefined;
    args.dirPath = dirPath ? normalizePath(dirPath) : context.repoPath;
  }
  if (toolCall.name === "read_file") {
    const filePath = args.filePath as string | undefined;
    if (filePath) args.filePath = normalizePath(filePath);
  }

  try {
    return await tool.handler(args);
  } catch (error) {
    return { error: String(error) };
  }
}

program
  .command("reproduce <repo-url>")
  .description("Autonomously reproduce a bug and generate a failing test artifact")
  .option("-i, --issue <text>", "Issue description or GitHub issue URL")
  .option("-m, --model <model>", "AI model to use", getDefaultModel())
  .option("-t, --target <dir>", "Target directory for cloning", ".repatch-temp")
  .option("-h, --hint <text>", "Provide a hint to steer the agent")
  .option("--local", "Run commands locally instead of in Docker")
  .action(async (repoUrl: string, options: { issue?: string; model: string; target: string; hint?: string; local?: boolean }) => {
    logger.info(`Repatch: Autonomous Bug Reproduction`);
    const { Orchestrator } = await import("./orchestrator/machine.js");
    const { createInitialState } = await import("./orchestrator/state.js");

    const targetDir = path.resolve(process.cwd(), options.target);
    const inputPath = path.resolve(repoUrl);
    const isLocalPath = fs.existsSync(inputPath);

    try {
      if (!isLocalPath) {
        logger.start(`Cloning repository...`);
        await cloneRepo(repoUrl, targetDir);
        logger.succeed(`Repository cloned.`);
      }
    } catch (error) {
      logger.fail(`Repository access failed: ${error}`);
      process.exit(1);
    }

    const workingDir = isLocalPath ? inputPath : targetDir;
    
    if (!options.local) {
      try {
        logger.start(`Generating sandbox environment...`);
        const { generateDockerfile } = await import("./sandbox/nixpacks.js");
        const { buildImage } = await import("./sandbox/docker.js");
        const dockerfile = await generateDockerfile(workingDir);
        await buildImage(dockerfile, "repatch-sandbox:latest");
        logger.succeed(`Sandbox built.`);
      } catch (error) {
        logger.fail(`Sandbox build failed: ${error}`);
        process.exit(1);
      }
    }

    const issueText = options.issue || "Fix the bug described in the repository";
    const initialState = createInitialState(repoUrl, "", issueText, workingDir, options.hint);
    const orchestrator = new Orchestrator(options.model, { isLocal: options.local });
    
    let state = initialState;
    const stepsToRun = ["UNDERSTAND", "EXPLORE", "REPRODUCE"];
    
    for (const step of stepsToRun) {
      state.currentStep = step as any;
      state = await orchestrator.transition(state);
    }
  });

program
  .command("fix <repo-url>")
  .description("Run the full autonomous fixing loop (Reproduce -> Fix -> PR)")
  .option("-i, --issue <text>", "Issue description or GitHub issue URL")
  .option("-m, --model <model>", "AI model to use", getDefaultModel())
  .option("-t, --target <dir>", "Target directory for cloning", ".repatch-temp")
  .option("-h, --hint <text>", "Provide a hint to steer the agent")
  .option("--local", "Run commands locally instead of in Docker")
  .action(async (repoUrl: string, options: { issue?: string; model: string; target: string; hint?: string; local?: boolean }) => {
    logger.info(`Repatch: Autonomous PR Fixer`);
    const { Orchestrator } = await import("./orchestrator/machine.js");
    const { createInitialState } = await import("./orchestrator/state.js");

    const targetDir = path.resolve(process.cwd(), options.target);
    const inputPath = path.resolve(repoUrl);
    const isLocalPath = fs.existsSync(inputPath);

    try {
      if (!isLocalPath) {
        logger.start(`Cloning repository...`);
        await cloneRepo(repoUrl, targetDir);
        logger.succeed(`Repository cloned.`);
      }
    } catch (error) {
      logger.fail(`Repository access failed: ${error}`);
      process.exit(1);
    }

    const workingDir = isLocalPath ? inputPath : targetDir;
    
    if (!options.local) {
      try {
        logger.start(`Generating sandbox environment...`);
        const { generateDockerfile } = await import("./sandbox/nixpacks.js");
        const { buildImage } = await import("./sandbox/docker.js");
        const dockerfile = await generateDockerfile(workingDir);
        await buildImage(dockerfile, "repatch-sandbox:latest");
        logger.succeed(`Sandbox built.`);
      } catch (error) {
        logger.fail(`Sandbox build failed: ${error}`);
        process.exit(1);
      }
    }

    let issueText = options.issue || "Fix the bug described in the repository";
    let issueUrl = "";

    // Auto-detect GitHub issue URLs like: https://github.com/owner/repo/issues/123
    const issueUrlMatch = options.issue?.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
    if (issueUrlMatch) {
      issueUrl = options.issue!;
      const issueNumber = parseInt(issueUrlMatch[3], 10);
      try {
        logger.start(`Fetching GitHub issue #${issueNumber}...`);
        const { fetchIssue } = await import("./adapters/github.js");
        const issue = await fetchIssue(repoUrl, issueNumber);
        issueText = `#${issue.number}: ${issue.title}\n\n${issue.body || ""}`.trim();
        logger.succeed(`Issue fetched: "${issue.title}"`);
      } catch (err) {
        logger.warn(`Could not fetch issue from GitHub (${err}). Using URL as issue text.`);
        issueText = options.issue!;
      }
    }

    const initialState = createInitialState(repoUrl, issueUrl, issueText, workingDir, options.hint);
    const orchestrator = new Orchestrator(options.model, { isLocal: options.local });
    await orchestrator.run(initialState);
  });

program
  .command("check")
  .description("Validate environment and configuration")
  .action(async () => {
    logger.info("Running diagnostic check...");
    
    // 1. Check Git
    logger.start("Checking Git...");
    try {
      const { execa } = await import("execa");
      await execa("git", ["--version"]);
      logger.succeed("Git is installed.");
    } catch {
      logger.fail("Git is not installed or not in PATH.");
    }

    // 2. Check Docker
    logger.start("Checking Docker...");
    const { isDockerAvailable } = await import("./sandbox/docker.js");
    if (await isDockerAvailable()) {
      logger.succeed("Docker is available.");
    } else {
      logger.warn("Docker is not available. Will use local execution fallback (less safe).");
    }

    // 3. Check Configuration
    logger.start("Checking Configuration...");
    const { config } = await import("./config/loader.js");
    logger.info(`  Model: ${config.model}`);

    const geminiKey = config.gemini?.apiKey || process.env.GEMINI_API_KEY;
    const openaiKey = config.openai?.apiKey || process.env.OPENAI_API_KEY;
    const anthropicKey = config.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY;
    const mimoKey = config.mimo?.apiKey || process.env.MIMO_API_KEY;

    if (geminiKey) logger.succeed("Gemini API Key is configured.");
    if (openaiKey) logger.succeed("OpenAI API Key is configured.");
    if (anthropicKey) logger.succeed("Anthropic API Key is configured.");
    if (mimoKey) logger.succeed("Mimo API Key is configured.");

    // Validate active provider configuration
    if (config.model.startsWith("gemini")) {
      if (geminiKey) {
        logger.succeed("Using native Gemini API Provider.");
      } else {
        logger.start("Gemini API key not found. Checking Gemini CLI fallback...");
        try {
          const { execa } = await import("execa");
          await execa("gemini", ["--version"]);
          logger.succeed("Gemini CLI is installed.");
        } catch {
          logger.fail("Neither Gemini API key nor Gemini CLI is available. Set GEMINI_API_KEY.");
        }
      }
    } else if (config.model.startsWith("gpt") || config.model.startsWith("deepseek")) {
      if (!openaiKey) {
        logger.fail("OpenAI API Key is missing but an OpenAI/DeepSeek model is selected.");
      }
    } else if (config.model.startsWith("claude")) {
      if (!anthropicKey) {
        logger.fail("Anthropic API Key is missing but an Anthropic model is selected.");
      }
    } else if (config.model.startsWith("mimo")) {
      if (!mimoKey) {
        logger.fail("Mimo API Key is missing but a Mimo model is selected. Set MIMO_API_KEY.");
      }
    }

    if (config.github?.token || process.env.GH_TOKEN) {
      logger.succeed("GitHub Token is configured.");
    } else {
      logger.warn("GitHub Token is missing. PR creation will fail.");
    }

    // 4. Test LLM Reachability
    logger.start("Testing LLM reachability...");
    try {
      const provider = createProvider({ model: config.model });
      const response = await provider.complete([
        { role: "user", content: "Respond with 'pong' and nothing else." }
      ]);
      if (response.content.toLowerCase().includes("pong")) {
        logger.succeed(`LLM (${config.model}) is reachable.`);
      } else {
        logger.warn(`LLM responded but content was unexpected: ${response.content}`);
      }
    } catch (error) {
      logger.fail(`LLM reachability test failed: ${error}`);
    }

    logger.succeed("Diagnostic check complete.");
  });

program
  .command("init")
  .description("Initialize a .repatch.yaml configuration file")
  .action(async () => {
    const configPath = path.join(process.cwd(), ".repatch.yaml");
    if (fs.existsSync(configPath)) {
      logger.warn(".repatch.yaml already exists.");
      return;
    }

    const template = `
# Repatch Configuration Template
model: "gemini-1.5-pro" # Options: gpt-4o, claude-3-5-sonnet-latest, etc.

openai:
  apiKey: "" # Or set OPENAI_API_KEY env var
  baseUrl: "https://api.openai.com/v1"

anthropic:
  apiKey: "" # Or set ANTHROPIC_API_KEY env var

github:
  token: "" # Or set GH_TOKEN env var

sandbox:
  memory: "2g"
  cpus: 1
  network: false

logging:
  level: "info"
`.trim();

    fs.writeFileSync(configPath, template, "utf-8");
    logger.succeed("Created .repatch.yaml template. Add your keys and run 'repatch check' to verify.");
  });

async function askQuestion(rl: any, query: string, defaultVal: string = ""): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`${query}${defaultVal ? ` (${defaultVal})` : ""}: `, (answer: string) => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

async function runConfigurationWizard(): Promise<void> {
  logger.info("Initializing Repatch Configuration Wizard...");
  const readline = await import("readline");
  const yaml = await import("js-yaml");
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const configPath = path.join(process.cwd(), ".repatch.yaml");
    let existingConfig: any = {};
    if (fs.existsSync(configPath)) {
      try {
        existingConfig = yaml.load(fs.readFileSync(configPath, "utf-8")) || {};
        logger.info(`Found existing configuration at ${configPath}. Options will default to current values.`);
      } catch {
        // ignore parsing error, start fresh
      }
    }

    const model = await askQuestion(rl, "Default AI Model", existingConfig.model || "gemini-1.5-pro");
    
    logger.info("\n--- Provider Configurations ---");
    const geminiKey = await askQuestion(rl, "Gemini API Key (leave empty to skip)", existingConfig.gemini?.apiKey || "");
    const openaiKey = await askQuestion(rl, "OpenAI API Key (leave empty to skip)", existingConfig.openai?.apiKey || "");
    const openaiBase = await askQuestion(rl, "OpenAI Base URL", existingConfig.openai?.baseUrl || "https://api.openai.com/v1");
    const anthropicKey = await askQuestion(rl, "Anthropic API Key (leave empty to skip)", existingConfig.anthropic?.apiKey || "");
    const mimoKey = await askQuestion(rl, "Mimo API Key (leave empty to skip)", existingConfig.mimo?.apiKey || "");
    const mimoBase = await askQuestion(rl, "Mimo Base URL", existingConfig.mimo?.baseUrl || "https://opengateway.gitlawb.com/v1");

    logger.info("\n--- GitHub Integration ---");
    const githubToken = await askQuestion(rl, "GitHub Token (for PR creation)", existingConfig.github?.token || "");

    logger.info("\n--- Sandbox Settings ---");
    const memory = await askQuestion(rl, "Sandbox Memory Limit", existingConfig.sandbox?.memory || "2g");
    const cpusStr = await askQuestion(rl, "Sandbox CPU Count", String(existingConfig.sandbox?.cpus || 1));
    const cpus = parseInt(cpusStr, 10) || 1;
    const networkStr = await askQuestion(rl, "Enable Sandbox Network Access? (y/n)", existingConfig.sandbox?.network ? "y" : "n");
    const network = networkStr.toLowerCase() === "y" || networkStr.toLowerCase() === "yes";

    const finalConfig = {
      model,
      openai: {
        apiKey: openaiKey || undefined,
        baseUrl: openaiBase
      },
      anthropic: {
        apiKey: anthropicKey || undefined
      },
      gemini: {
        apiKey: geminiKey || undefined
      },
      mimo: {
        apiKey: mimoKey || undefined,
        baseUrl: mimoBase
      },
      github: {
        token: githubToken || undefined
      },
      sandbox: {
        memory,
        cpus,
        network
      },
      logging: {
        level: existingConfig.logging?.level || "info"
      }
    };

    // Clean up undefined properties to keep yaml neat
    const cleanConfig = JSON.parse(JSON.stringify(finalConfig));

    fs.writeFileSync(configPath, yaml.dump(cleanConfig), "utf-8");
    logger.succeed(`\nConfiguration saved successfully to ${configPath}`);
  } catch (error) {
    logger.fail(`Failed to save configuration: ${error}`);
  } finally {
    rl.close();
  }
}

program
  .command("configure")
  .description("Interactively configure repatch settings and API keys")
  .action(runConfigurationWizard);

program
  .command("setup")
  .description("Interactively configure repatch settings and API keys (alias for configure)")
  .action(runConfigurationWizard);

program
  .command("pr <pr-url>")
  .description("Analyze and optionally fix a Pull Request")
  .option("-m, --model <model>", "AI model to use", getDefaultModel())
  .option("-t, --target <dir>", "Target directory for cloning", ".repatch-temp")
  .option("--fix", "Automatically apply fixes and update PR")
  .action(async (prUrl: string, options: { model: string; target: string; fix?: boolean }) => {
    logger.info(`Repatch: Autonomous PR Analyzer`);
    
    // Lazy imports for performance
    const { getPullRequest, getPullRequestDiff, parseRepoUrl } = await import("./adapters/github.js");
    const { checkoutPR } = await import("./adapters/git.js");
    const { createOrchestrator } = await import("./orchestrator/machine.js");
    const { createInitialState } = await import("./orchestrator/state.js");

    try {
      logger.start(`Fetching PR details...`);
      const { owner, repo } = parseRepoUrl(prUrl);
      const prNumber = parseInt(prUrl.split("/").pop() || "0", 10);
      if (!prNumber) throw new Error("Could not extract PR number from URL");

      const repoUrl = `https://github.com/${owner}/${repo}`;
      const prDetails = await getPullRequest(repoUrl, prNumber);
      const prDiff = await getPullRequestDiff(repoUrl, prNumber);
      logger.succeed(`Fetched PR #${prNumber}: ${prDetails.title}`);

      const targetDir = path.resolve(process.cwd(), options.target);
      
      logger.start(`Cloning repository and checking out PR branch...`);
      await cloneRepo(repoUrl, targetDir);
      await checkoutPR(targetDir, prNumber);
      logger.succeed(`Checked out PR branch locally.`);

      const workingDir = targetDir;
      
      try {
        logger.start(`Generating sandbox environment...`);
        const dockerfile = await generateDockerfile(workingDir);
        await buildImage(dockerfile, "repatch-sandbox:latest");
        logger.succeed(`Sandbox built.`);
      } catch (error) {
        logger.fail(`Sandbox build failed: ${error}`);
        process.exit(1);
      }

      const issueText = `Please review and fix issues in PR #${prNumber}: ${prDetails.title}\n\nDescription:\n${prDetails.body}\n\nDiff:\n${prDiff.slice(0, 5000)}`;
      const initialState = createInitialState(repoUrl, "", issueText, workingDir);
      const orchestrator = createOrchestrator(options.model);
      
      if (options.fix) {
        logger.info(`Running full autonomous fix loop...`);
        await orchestrator.run(initialState);
      } else {
        logger.info(`Running analysis only (UNDERSTAND and EXPLORE)...`);
        let state = initialState;
        const stepsToRun = ["UNDERSTAND", "EXPLORE"];
        for (const step of stepsToRun) {
          state.currentStep = step as any;
          state = await orchestrator.transition(state);
        }
        logger.succeed(`Analysis complete. Run with --fix to apply changes.`);
      }
    } catch (error) {
      logger.fail(`PR analysis failed: ${error}`);
      process.exit(1);
    }
  });

program.parse();
