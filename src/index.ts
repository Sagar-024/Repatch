#!/usr/bin/env node

import { Command } from "commander";
import { cloneRepo } from "./adapters/git.js";
import { getBuildPlan } from "./sandbox/nixpacks.js";
import { buildImage, runInContainer } from "./sandbox/docker.js";
import { createProvider, getDefaultModel, getToolsForLLM, ToolCall } from "./inference/provider.js";
import { getTool } from "./tools/registry.js";
import * as path from "path";
import * as fs from "fs";

const program = new Command();

program
  .name("pr-fixer")
  .description("Autonomous PR fixer - Junior Developer in a box")
  .version("0.1.0");

program
  .command("fix <url>")
  .description("Clone a repo and set up the sandbox environment")
  .option("-t, --target <dir>", "Target directory for cloning", ".pr-fixer-temp")
  .action(async (url: string, options: { target: string }) => {
    console.log(`\n🛠️  PR-Fixer starting...\n`);

    const targetDir = path.resolve(process.cwd(), options.target);

    // Story 1: Repo Cloning & Auth
    console.log(`📦 Step 1: Cloning repository...`);
    console.log(`   URL: ${url}`);
    try {
      await cloneRepo(url, targetDir);
      console.log(`   ✅ Cloned to: ${targetDir}\n`);
    } catch (error) {
      console.error(`   ❌ Clone failed: ${error}`);
      process.exit(1);
    }

    // Story 2: Zero-Config Detection
    console.log(`🔍 Step 2: Detecting environment with Nixpacks...`);
    try {
      const plan = await getBuildPlan(targetDir);
      console.log(`   ✅ Detected: ${plan.builder}`);
      console.log(`   📋 Build plan: ${JSON.stringify(plan, null, 2)}\n`);
    } catch (error) {
      console.error(`   ❌ Detection failed: ${error}`);
      process.exit(1);
    }

    // Story 3: Sandboxed Execution
    console.log(`🐳 Step 3: Building Docker sandbox...`);
    try {
      const dockerfile = await generateDockerfile(targetDir);
      const imageTag = "pr-fixer-sandbox:latest";
      await buildImage(dockerfile, imageTag);
      console.log(`   ✅ Image built: ${imageTag}\n`);

      console.log(`🚀 Step 4: Running smoke test in container...`);
      const result = await runInContainer(imageTag, "ls -la");
      console.log(`   📄 Container output:`);
      console.log(result.stdout);
      console.log(`   ✅ Sandboxed execution successful!\n`);
    } catch (error) {
      console.error(`   ❌ Sandbox failed: ${error}`);
      process.exit(1);
    }

    console.log(`✨ Epic 1 complete! Environment foundation ready.`);
  });

program
  .command("verify <url>")
  .description("Verify repo can be cloned and containerized (smoke test)")
  .action(async (url: string) => {
    console.log(`\n🧪 Running Epic 1 smoke tests...\n`);

    const targetDir = path.resolve(process.cwd(), `.pr-fixer-${Date.now()}`);

    // Clean up if exists
    try {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }

    try {
      // Test 1: Clone
      console.log(`Test 1: Clone repo`);
      await cloneRepo(url, targetDir);
      console.log(`  ✅ Clone passed\n`);

      // Test 2: Nixpacks detection
      console.log(`Test 2: Nixpacks detection`);
      const plan = await getBuildPlan(targetDir);
      console.log(`  ✅ Detection: ${plan.builder}\n`);

      // Test 3: Docker build and run
      console.log(`Test 3: Docker sandbox`);
      const dockerfile = await generateDockerfile(targetDir);
      await buildImage(dockerfile, "pr-fixer-verify:latest");
      const result = await runInContainer("pr-fixer-verify:latest", "echo 'hello from container'");
      console.log(`  ✅ Container: ${result.stdout.trim()}\n`);

      console.log(`🎉 All smoke tests passed!`);
    } catch (error) {
      console.error(`\n❌ Smoke test failed: ${error}`);
      process.exit(1);
    } finally {
      // Cleanup
      try {
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  });

async function generateDockerfile(repoPath: string): Promise<string> {
  // Use nixpacks to generate a Dockerfile
  const { execa } = await import("execa");
  try {
    const { stdout } = await execa("nixpacks", ["build"], {
      cwd: repoPath,
      reject: false
    });
    // nixpacks build outputs a Dockerfile to stdout
    return stdout;
  } catch {
    // Fallback to a basic Dockerfile
    return `FROM node:20-slim\nWORKDIR /app\nCOPY . .\nRUN npm install 2>/dev/null || true`;
  }
}

program
  .command("explore <path>")
  .description("Explore a codebase using the LLM with tool access")
  .option("-m, --model <model>", "AI model to use", getDefaultModel())
  .option("-q, --question <text>", "Question to ask about the codebase")
  .option("-i, --interactive", "Interactive REPL mode", false)
  .action(async (repoPath: string, options: { model: string; question?: string; interactive: boolean }) => {
    console.log(`\n🧠 Epic 2: The Brain & Tool Library\n`);
    console.log(`   Model: ${options.model}`);
    console.log(`   Path: ${path.resolve(repoPath)}\n`);

    // Resolve absolute path
    const absPath = path.resolve(repoPath);

    if (!fs.existsSync(absPath)) {
      console.error(`❌ Path does not exist: ${absPath}`);
      process.exit(1);
    }

    // Initialize LLM
    const provider = createProvider({ model: options.model });
    const tools = getToolsForLLM();

    // Context for tools - store the repo path
    const toolContext = { repoPath: absPath };

    // System prompt
    const systemPrompt = `You are a code exploration tool. You MUST use tools when the user asks you to explore.

REPO PATH: ${absPath}

When you need to use a tool, respond with ONLY this exact JSON format (no other text):
{"name": "tool_name", "arguments": {"param": "full path here"}}

Example - to list files in the project root:
{"name": "list_files", "arguments": {"dirPath": "${absPath}"}}

Example - to read package.json:
{"name": "read_file", "arguments": {"filePath": "${absPath}/package.json"}}

If you don't need a tool, answer directly. Never use relative paths like "package.json" - always use absolute paths starting with ${absPath}`;

    // Interactive mode
    if (options.interactive) {
      await runInteractiveMode(provider, tools, systemPrompt, toolContext);
    } else if (options.question) {
      await runSingleQuery(provider, tools, systemPrompt, toolContext, options.question);
    } else {
      // Default: show file structure
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
  provider: ReturnType<typeof createProvider>,
  tools: ReturnType<typeof getToolsForLLM>,
  systemPrompt: string,
  toolContext: { repoPath: string },
  question: string
): Promise<void> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: question }
  ];

  console.log(`❓ Question: ${question}\n`);

  let response = await provider.complete(messages, tools);
  let iterations = 0;
  const maxIterations = 5;

  while (response.toolCalls && iterations < maxIterations) {
    // Handle tool calls
    for (const toolCall of response.toolCalls) {
      console.log(`🔧 Calling tool: ${toolCall.name}`);
      const result = await executeTool(toolCall, toolContext);
      console.log(`   Result: ${JSON.stringify(result).slice(0, 200)}...\n`);

      // Add tool result to messages
      messages.push({
        role: "assistant",
        content: `[Called tool: ${toolCall.name} with ${JSON.stringify(toolCall.arguments)}]`
      });
      messages.push({
        role: "user",
        content: `Tool result: ${JSON.stringify(result)}`
      });
    }

    // Get next response
    response = await provider.complete(messages, tools);
    iterations++;
  }

  console.log(`💬 Answer:\n${response.content}\n`);
}

async function runInteractiveMode(
  provider: ReturnType<typeof createProvider>,
  tools: ReturnType<typeof getToolsForLLM>,
  systemPrompt: string,
  toolContext: { repoPath: string }
): Promise<void> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt }
  ];

  console.log(`🔍 Interactive mode. Type "exit" to quit.\n`);

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
        const response = await provider.complete(messages, tools);
        console.log(`\n💬 ${response.content}\n`);

        // Handle tool calls
        if (response.toolCalls) {
          for (const toolCall of response.toolCalls) {
            console.log(`🔧 Calling tool: ${toolCall.name}`);
            const result = await executeTool(toolCall, toolContext);
            console.log(`   Result: ${JSON.stringify(result).slice(0, 500)}\n`);

            messages.push({
              role: "assistant",
              content: `[Called tool: ${toolCall.name}]`
            });
            messages.push({
              role: "user",
              content: `Tool result: ${JSON.stringify(result)}`
            });
          }

          // Get final response after tools
          const finalResponse = await provider.complete(messages, tools);
          console.log(`💬 ${finalResponse.content}\n`);
        }
      } catch (error) {
        console.error(`Error: ${error}`);
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

  // Inject repo path context into arguments
  const args: Record<string, unknown> = { ...toolCall.arguments };

  // Fix path normalization - model may return Unix-style paths on Windows
  const normalizePath = (p: string): string => {
    // Handle /C:/ style paths
    if (p.startsWith("/C:/")) {
      return p.slice(1); // Remove leading /
    }
    // Handle /c/ style paths
    if (p.startsWith("/c/")) {
      return "C:" + p.slice(2);
    }
    return p;
  };

  // For filesystem tools, inject repoPath if not provided or normalize
  if (toolCall.name === "list_files") {
    const dirPath = args.dirPath as string | undefined;
    if (!dirPath) {
      args.dirPath = context.repoPath;
    } else {
      args.dirPath = normalizePath(dirPath);
    }
  }
  if (toolCall.name === "grep_search") {
    const dirPath = args.dirPath as string | undefined;
    if (!dirPath) {
      args.dirPath = context.repoPath;
    } else {
      args.dirPath = normalizePath(dirPath);
    }
  }
  if (toolCall.name === "read_file") {
    const filePath = args.filePath as string | undefined;
    if (filePath) {
      args.filePath = normalizePath(filePath);
    }
  }

  try {
    return await tool.handler(args);
  } catch (error) {
    return { error: String(error) };
  }
}

program
  .command("autofix <repo-url>")
  .description("Run autonomous PR fixing (Epic 3 & 4: Understand to Submit)")
  .option("-i, --issue <text>", "Issue description or GitHub issue URL")
  .option("-m, --model <model>", "AI model to use", getDefaultModel())
  .option("-t, --target <dir>", "Target directory for cloning", ".pr-fixer-temp")
  .option("-h, --hint <text>", "Provide a hint to steer the agent")
  .option("--open-pr", "Create a pull request on GitHub", true)
  .option("--no-open-pr", "Stop after verification and save results locally")
  .action(async (repoUrl: string, options: { issue?: string; model: string; target: string; openPr: boolean; hint?: string }) => {
    console.log(`\n🚀 Repatch: Autonomous PR Fixer\n`);
    console.log(`   Repo: ${repoUrl}`);
    console.log(`   Model: ${options.model}`);
    console.log(`   Issue: ${options.issue || "User provided"}`);
    console.log(`   Hint: ${options.hint || "None"}`);
    console.log(`   Open PR: ${options.openPr}\n`);

    // Import orchestrator
    const { createOrchestrator } = await import("./orchestrator/machine.js");
    const { createInitialState } = await import("./orchestrator/state.js");

    const targetDir = path.resolve(process.cwd(), options.target);
    const inputPath = path.resolve(repoUrl);
    const isLocalPath = fs.existsSync(inputPath);

    // Step 1: Clone repo (or use local path)
    console.log(`📦 Step 1: ${isLocalPath ? "Using local repository" : "Cloning repository"}...`);
    try {
      if (isLocalPath) {
        console.log(`   📂 Using: ${inputPath}\n`);
      } else {
        await cloneRepo(repoUrl, targetDir);
        console.log(`   ✅ Cloned to: ${targetDir}\n`);
      }
    } catch (error) {
      console.error(`   ❌ Repository access failed: ${error}`);
      process.exit(1);
    }

    const workingDir = isLocalPath ? inputPath : targetDir;

    // Step 2: Build sandbox
    console.log(`🐳 Step 2: Building sandbox...`);
    let imageTag = "pr-fixer-sandbox:latest";
    try {
      const dockerfile = await generateDockerfile(workingDir);
      const { buildImage } = await import("./sandbox/docker.js");
      await buildImage(dockerfile, imageTag);
      console.log(`   ✅ Image built: ${imageTag}\n`);
    } catch (error) {
      console.error(`   ❌ Sandbox build failed: ${error}`);
      process.exit(1);
    }

    // Step 3: Run the orchestrator
    const issueText = options.issue || "Fix the bug described in the repository";
    const initialState = createInitialState(repoUrl, "", issueText, workingDir, options.hint);

    console.log(`🤖 Step 3: Running autonomous fix loop...`);
    const orchestrator = createOrchestrator(options.model);
    
    // V1 Decoupled Execution
    const finalState = await orchestrator.run(initialState);

    console.log(`\n✨ Done!`);
    console.log(`   Steps completed: ${finalState.history.length}`);
    console.log(`   Current step: ${finalState.currentStep}`);
    if (finalState.errorLogs.length > 0) {
      console.log(`   ⚠️ Errors encountered: ${finalState.errorLogs.length}`);
    }
  });

program.parse();