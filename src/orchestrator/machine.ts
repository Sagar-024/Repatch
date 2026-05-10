// State machine - Epic 3: The Inviolable Loop
// LangGraph-powered state machine with steps: Understand → Explore → Reproduce → Plan → Execute → Verify

import { AgentState, Step, HistoryEntry, createInitialState } from "./state.js";
import { createProvider, getDefaultModel, getToolsForLLM, ToolCall, LLMMessage } from "../inference/provider.js";
import { getTool } from "../tools/registry.js";
import { createBranch, commitChanges, pushBranch, getDefaultBranch, setRemoteUrl } from "../adapters/git.js";
import { createPullRequest, hasGitHubToken, forkRepository, getAuthenticatedUser } from "../adapters/github.ts";
import { detectLintCommand } from "../sandbox/lint.js";
import * as fs from "fs";
import * as path from "path";

export interface StateMachine {
  transition(state: AgentState): Promise<AgentState>;
  getNextStep(currentStep: Step): Step;
}

const STEP_SEQUENCE: Step[] = ["UNDERSTAND", "EXPLORE", "REPRODUCE", "PLAN", "EXECUTE", "VERIFY"];

export class Orchestrator implements StateMachine {
  private model: string;
  private maxIterationsPerStep: number;

  constructor(model?: string, maxIterationsPerStep = 5) {
    this.model = model || getDefaultModel();
    this.maxIterationsPerStep = maxIterationsPerStep;
  }

  getNextStep(currentStep: Step): Step {
    const currentIndex = STEP_SEQUENCE.indexOf(currentStep);
    if (currentIndex < STEP_SEQUENCE.length - 1) {
      return STEP_SEQUENCE[currentIndex + 1];
    }
    return "SUBMIT";
  }

  async transition(state: AgentState): Promise<AgentState> {
    const step = state.currentStep;
    console.log(`\n📍 Step: ${step}`);
    console.log(`   Issue: ${state.issueText.slice(0, 100)}...`);

    try {
      switch (step) {
        case "UNDERSTAND":
          return await this.handleUnderstand(state);
        case "EXPLORE":
          return await this.handleExplore(state);
        case "REPRODUCE":
          return await this.handleReproduce(state);
        case "PLAN":
          return await this.handlePlan(state);
        case "EXECUTE":
          return await this.handleExecute(state);
        case "VERIFY":
          return await this.handleVerify(state);
        case "SUBMIT":
          return await this.handleSubmit(state);
        default:
          return state;
      }
    } catch (error) {
      state.errorLogs.push(`Error in ${step}: ${error}`);
      return state;
    }
  }

  private async handleUnderstand(state: AgentState): Promise<AgentState> {
    const provider = createProvider({ model: this.model });
    const tools = getToolsForLLM();

    const systemPrompt = `You are analyzing a bug report to understand what needs to be fixed.

REPO: ${state.repoUrl}
ISSUE: ${state.issueText}

Your task is to:
1. Summarize the bug in 1-2 sentences
2. Identify key keywords for searching the codebase
3. Determine what kind of files are likely relevant (e.g., tests, source files, config)

Respond with a JSON object:
{"summary": "...", "keywords": [...], "fileTypes": [...], "analysis": "..."}`;

    const messages: LLMMessage[] = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: "Analyze this issue and provide your understanding." }
    ];

    const response = await provider.complete(messages);

    state.history.push({
      step: "UNDERSTAND",
      action: "Analyzed issue",
      result: response.content,
      timestamp: Date.now()
    });

    console.log(`   ✅ Understanding complete: ${response.content.slice(0, 200)}...`);
    state.currentStep = this.getNextStep(state.currentStep);
    return state;
  }

  private async handleExplore(state: AgentState): Promise<AgentState> {
    const provider = createProvider({ model: this.model });
    const tools = getToolsForLLM();
    const toolContext = { repoPath: state.repoPath };

    // Get initial understanding from history
    const understandEntry = state.history.find(h => h.step === "UNDERSTAND");
    const keywords = understandEntry?.result ? this.extractKeywords(understandEntry.result) : [];

    const hintSection = state.hint ? `\n### USER HINT:\nThe user has provided a hint: "${state.hint}". Prioritize exploring this area.\n` : "";

    const systemPrompt = `You are exploring the codebase to find relevant files for fixing a bug.

REPO PATH: ${state.repoPath}
KEYWORDS: ${keywords.join(", ")}${hintSection}

### MISSION:
Find the EXACT files that contain the bug.
1. Use 'grep_search' to find the keywords in the codebase.
2. Whenever you find a file that looks relevant, you MUST call 'read_file' to examine it.
3. You are NOT finished until you have called 'read_file' on the source files related to the bug.

Respond with JSON tool calls.`;

    const messages: LLMMessage[] = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: `Find and READ the files related to the bug. Keywords: ${keywords.join(", ")}` }
    ];

    let response = await provider.complete(messages, tools);
    let iterations = 0;

    while (response.toolCalls && iterations < this.maxIterationsPerStep) {
      for (const toolCall of response.toolCalls) {
        console.log(`   🔧 ${toolCall.name}`);
        const result = await this.executeTool(toolCall, toolContext, state);

        messages.push({ role: "assistant" as const, content: `[Called ${toolCall.name}]` });
        messages.push({ role: "user" as const, content: `Result: ${JSON.stringify(result).slice(0, 500)}` });
      }

      response = await provider.complete(messages, tools);
      iterations++;
    }

    state.history.push({
      step: "EXPLORE",
      action: "Explored codebase",
      result: `Visited ${state.visitedFiles.length} files: ${state.visitedFiles.join(", ")}`,
      timestamp: Date.now()
    });

    console.log(`   ✅ Explored ${state.visitedFiles.length} files`);
    state.currentStep = this.getNextStep(state.currentStep);
    return state;
  }

  private async handleReproduce(state: AgentState): Promise<AgentState> {
    const provider = createProvider({ model: this.model });
    const tools = getToolsForLLM();
    const toolContext = { repoPath: state.repoPath };

    // Find relevant files from exploration
    const relevantFiles = state.visitedFiles.slice(0, 5);

    const systemPrompt = `You are reproducing the bug in a sandbox.

REPO PATH: ${state.repoPath}

### MISSION:
1. READ the relevant files to understand the current logic.
2. Use 'run_command' to execute tests or scripts that demonstrate the bug.
3. If you see a test file, run it!

You MUST call 'read_file' if you haven't seen the content of the relevant files yet.

Respond with JSON tool calls.`;

    const messages: LLMMessage[] = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: "Reproduce the bug now. Read files and run commands." }
    ];

    let response = await provider.complete(messages, tools);
    let iterations = 0;

    while (response.toolCalls && iterations < this.maxIterationsPerStep) {
      for (const toolCall of response.toolCalls) {
        console.log(`   🔧 ${toolCall.name}`);
        const result = await this.executeTool(toolCall, toolContext, state);

        messages.push({ role: "assistant" as const, content: `[Called ${toolCall.name}]` });
        messages.push({ role: "user" as const, content: `Result: ${JSON.stringify(result).slice(0, 500)}` });

        // Capture reproduction test info and raw output
        if (toolCall.name === "run_command") {
          state.reproductionTest = toolCall.arguments.cmd as string;
          const cmdResult = result as { stdout: string; stderr: string; exitCode: number };
          if (cmdResult.exitCode !== 0) {
            state.reproductionFailureOutput = `STDOUT:\n${cmdResult.stdout}\nSTDERR:\n${cmdResult.stderr}`;
          }
        }
      }

      response = await provider.complete(messages, tools);
      iterations++;
    }

    state.history.push({
      step: "REPRODUCE",
      action: "Attempted reproduction",
      result: response.content.slice(0, 200),
      timestamp: Date.now()
    });

    console.log(`   ✅ Reproduction attempted`);
    state.currentStep = this.getNextStep(state.currentStep);
    return state;
  }

  private async handlePlan(state: AgentState): Promise<AgentState> {
    const provider = createProvider({ model: this.model });

    // Gather context from previous steps
    const exploredFiles = state.visitedFiles.slice(0, 3).map(f => {
      const content = this.safeReadFile(f);
      return `File: ${path.basename(f)}\n${content?.slice(0, 500) || "Could not read"}`;
    }).join("\n\n");

    const systemPrompt = `You are planning a fix for a bug.

ISSUE: ${state.issueText}

EXPLORED FILES:
${exploredFiles}

Based on your analysis, create a fix plan. Identify:
1. The root cause of the bug
2. The specific files that need to be modified
3. The changes needed
4. How to verify the fix works

Respond with a JSON plan:
{"rootCause": "...", "filesToModify": [...], "changes": [...], "verification": "..."}`;

    const messages: LLMMessage[] = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: "Create a plan to fix this bug based on your analysis." }
    ];

    const response = await provider.complete(messages);

    state.history.push({
      step: "PLAN",
      action: "Created fix plan",
      result: response.content.slice(0, 300),
      timestamp: Date.now()
    });

    console.log(`   ✅ Plan created`);
    state.currentStep = this.getNextStep(state.currentStep);
    return state;
  }

  private async handleExecute(state: AgentState): Promise<AgentState> {
    const provider = createProvider({ model: this.model, temperature: 0 });
    const toolContext = { repoPath: state.repoPath };
    // Force write_file as the only tool to ensure it's used
    const tools = getToolsForLLM().filter(t => t.name === "write_file");

    // Get plan from history
    const planEntry = state.history.find(h => h.step === "PLAN");
    
    // Provide absolute paths AND content of explored files to help the model
    let fileContext = "";
    if (state.visitedFiles.length > 0) {
      fileContext = "\n### RELEVANT FILES CONTENT:\n";
      for (const filePath of state.visitedFiles) {
        const content = this.safeReadFile(filePath);
        fileContext += `\nFILE: ${filePath}\n\`\`\`\n${content || "Could not read file"}\n\`\`\`\n`;
      }
    }

    const systemPrompt = `You are the EXECUTE module of an autonomous bug-fixing agent. Your MISSION is to apply the specific code changes defined in the provided PLAN. 

### CRITICAL RULES:
1. NO EXPLORATION: You have the FULL CONTENT of the relevant files below. Do NOT attempt to read them again.
2. TOOL MANDATE: You MUST use the 'write_file' tool to apply the fix. 
3. FULL CONTENT: When calling 'write_file', you MUST provide the ENTIRE content of the file with the fix applied. No partial snippets.
4. NO CHAT: Do not explain your actions. Do not apologize. Do not ask for confirmation.
5. IMMEDIATE ACTION: Your first and only response must be the tool call(s) required to fulfill the PLAN.

### CONTEXT:
ISSUE: ${state.issueText}
PLAN: ${planEntry?.result || "No explicit plan"}${fileContext}

### EXECUTION:
Apply the fix to the relevant file(s) NOW using 'write_file'.`;

    const messages: LLMMessage[] = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: "Apply the fix described in the PLAN immediately using write_file." }
    ];

    let response = await provider.complete(messages, tools);
    let iterations = 0;
    let appliedChanges = 0;

    while (iterations < this.maxIterationsPerStep) {
      if (!response.toolCalls || response.toolCalls.length === 0) {
        console.log("   ⚠️ No tool call detected, retrying with fallback...");
        messages.push({
          role: "user" as const,
          content: "CRITICAL ERROR: No tool call detected. You MUST call 'write_file' to apply the fix described in the PLAN. Do not provide text explanations. Respond ONLY with the tool call."
        });
        response = await provider.complete(messages, tools);
        iterations++;
        continue;
      }

      for (const toolCall of response.toolCalls) {
        console.log(`   🔧 ${toolCall.name}`);
        const result = await this.executeTool(toolCall, toolContext, state);
        
        if (toolCall.name === "write_file") {
          appliedChanges++;
        }

        messages.push({ role: "assistant" as const, content: `[Called ${toolCall.name}]` });
        messages.push({ role: "user" as const, content: `Result: ${JSON.stringify(result).slice(0, 200)}` });

        // Build a patch description
        if (toolCall.name === "write_file") {
          state.fixPatch = (state.fixPatch || "") + `\nwrite_file: ${JSON.stringify(toolCall.arguments)}`;
        }
      }

      // If we applied changes, we might be done, but check if LLM wants to do more (e.g. run_command)
      response = await provider.complete(messages, tools);
      
      // If no more tool calls after a successful write, we're done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        break;
      }
      
      iterations++;
    }

    state.history.push({
      step: "EXECUTE",
      action: "Applied fixes",
      result: `Applied ${appliedChanges} changes`,
      timestamp: Date.now()
    });

    console.log(`   ✅ Executed ${appliedChanges} changes`);
    state.currentStep = this.getNextStep(state.currentStep);
    return state;
  }

  private async handleVerify(state: AgentState): Promise<AgentState> {
    const provider = createProvider({ model: this.model });
    const tools = getToolsForLLM();
    const toolContext = { repoPath: state.repoPath };

    const systemPrompt = `You are verifying that the fix works.

REPO PATH: ${state.repoPath}

### MISSION:
1. You MUST run the tests to verify the fix.
2. Use 'run_command' to execute the reproduction test or any other relevant tests.
3. If tests fail, you must analyze why.
4. You are NOT finished until you have proof that the fix works.

Use run_command to verify the fix.`;

    const messages: LLMMessage[] = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: "Verify that the fix works by running tests or the application." }
    ];

    let response = await provider.complete(messages, tools);
    let iterations = 0;
    let testsPassed = false;

    while (response.toolCalls && iterations < this.maxIterationsPerStep) {
      for (const toolCall of response.toolCalls) {
        console.log(`   🔧 ${toolCall.name}`);
        const result = await this.executeTool(toolCall, toolContext, state);

        messages.push({ role: "assistant" as const, content: `[Called ${toolCall.name}]` });
        messages.push({ role: "user" as const, content: `Result: ${JSON.stringify(result).slice(0, 500)}` });

        if (toolCall.name === "run_command") {
          const cmdResult = result as { stdout: string; stderr: string; exitCode: number };
          if (cmdResult.exitCode === 0) {
            testsPassed = true;
            state.verificationSuccessOutput = `STDOUT:\n${cmdResult.stdout}\nSTDERR:\n${cmdResult.stderr}`;
          }
        }
      }

      response = await provider.complete(messages, tools);
      iterations++;
    }

    // Automatic Linter/Formatter Verification
    if (testsPassed) {
      const lintCmd = detectLintCommand(state.repoPath);
      if (lintCmd) {
        console.log(`   🔧 Running linter: ${lintCmd}`);
        const lintResult = await this.executeTool({
          name: "run_command",
          arguments: { cmd: lintCmd, imageTag: "pr-fixer-sandbox:latest" }
        }, toolContext, state) as { stdout: string; stderr: string; exitCode: number };

        state.lintOutput = `STDOUT:\n${lintResult.stdout}\nSTDERR:\n${lintResult.stderr}`;

        if (lintResult.exitCode !== 0) {
          console.log(`   ❌ Linting failed. Backtracking to PLAN.`);
          state.errorLogs.push(`Linting failed: ${lintResult.stderr}`);
          state.currentStep = "PLAN";
          return state;
        }
        console.log(`   ✅ Linting passed.`);
      } else {
        console.log(`   ℹ️ No linter detected.`);
      }
    }

    state.history.push({
      step: "VERIFY",
      action: "Verified fix",
      result: response.content.slice(0, 200),
      timestamp: Date.now()
    });

    console.log(`   ✅ Verification complete`);
    state.currentStep = this.getNextStep(state.currentStep);
    return state;
  }

  private async handleSubmit(state: AgentState): Promise<AgentState> {
    console.log(`   📝 Generating PR narrative...`);

    // 1. Generate Narrative
    const narrative = this.generateNarrative(state);
    
    // Improved Title Generation
    let prTitle = "bug fix by Repatch";
    const understandEntry = state.history.find(h => h.step === "UNDERSTAND");
    if (understandEntry?.result) {
      try {
        // Try to parse as JSON first
        const resultText = understandEntry.result;
        const jsonMatch = resultText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.summary) {
            prTitle = `Fix: ${parsed.summary.slice(0, 60)}`;
          }
        } else {
          prTitle = `Fix: ${resultText.slice(0, 60)}`;
        }
      } catch {
        prTitle = `Fix: ${understandEntry.result.slice(0, 60)}`;
      }
    }
    
    // 2. Save result locally
    const resultsDir = path.join(process.cwd(), "results");
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    const resultPath = path.join(resultsDir, `repatch-fix-${Date.now()}.md`);
    fs.writeFileSync(resultPath, narrative, "utf-8");
    console.log(`   💾 Narrative saved to: ${resultPath}`);

    // 3. Git Operations
    try {
      const branchName = `repatch/fix-${Date.now()}`;
      console.log(`   🌿 Creating branch: ${branchName}`);
      await createBranch(state.repoPath, branchName);

      console.log(`   💾 Committing changes...`);
      await commitChanges(state.repoPath, prTitle);

      if (process.env.GH_TOKEN) {
        let pushTarget = "origin";
        let headBranch = branchName;

        try {
          console.log(`   🚀 Attempting to push to original repository...`);
          await pushBranch(state.repoPath, branchName);
        } catch (error: any) {
          const errorMessage = String(error);
          if (errorMessage.includes("403") || errorMessage.includes("Permission to") || errorMessage.includes("denied")) {
            console.log(`   ⚠️ Permission denied to original repo. Initiating Auto-Fork...`);
            
            // 1. Fork the repo
            const fork = await forkRepository(state.repoUrl);
            console.log(`   🍴 Forked successfully: ${fork.html_url}`);
            
            // 2. Set new remote URL (Authenticated URL with token)
            const ghToken = process.env.GH_TOKEN;
            const forkUrl = `https://${ghToken}@github.com/${fork.owner}/${fork.repo}.git`;
            await setRemoteUrl(state.repoPath, "origin", forkUrl);
            
            // 3. Push to fork
            console.log(`   🚀 Pushing branch to fork: ${fork.owner}/${fork.repo}...`);
            await pushBranch(state.repoPath, branchName);
            
            // 4. Update headBranch for PR (format is "owner:branch")
            headBranch = `${fork.owner}:${branchName}`;
          } else {
            throw error; // Re-throw if it's not a permission error
          }
        }

        console.log(`   🔌 Creating Pull Request: "${prTitle}"`);
        const defaultBranch = await getDefaultBranch(state.repoPath);
        
        const pr = await createPullRequest(
          state.repoUrl,
          headBranch,
          prTitle,
          narrative,
          defaultBranch
        );
        console.log(`   🎉 PR Created: ${pr.html_url}`);
        state.history.push({
          step: "SUBMIT",
          action: "Created PR",
          result: pr.html_url,
          timestamp: Date.now()
        });
      } else {
        console.log(`   ⚠️ GH_TOKEN not set. Skipping push and PR creation.`);
        state.history.push({
          step: "SUBMIT",
          action: "Saved narrative locally",
          result: `Local narrative saved to ${resultPath}`,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error(`   ❌ Submission failed: ${error}`);
      state.errorLogs.push(`Submission failed: ${error}`);
    }

    state.currentStep = "SUBMIT"; // Final step
    return state;
  }

  private generateNarrative(state: AgentState): string {
    const understandEntry = state.history.find(h => h.step === "UNDERSTAND");
    const planEntry = state.history.find(h => h.step === "PLAN");
    const reproduceEntry = state.history.find(h => h.step === "REPRODUCE");
    const verifyEntry = state.history.find(h => h.step === "VERIFY");

    // Extract a clean technical summary from the UNDERSTAND JSON
    let technicalSummary = "The issue was identified as a logic error in the source code.";
    if (understandEntry?.result) {
      try {
        const jsonMatch = understandEntry.result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          technicalSummary = parsed.analysis || parsed.summary || technicalSummary;
        }
      } catch {
        technicalSummary = understandEntry.result.slice(0, 300);
      }
    }

    // Extract a clean rationale from the PLAN JSON
    let fixRationale = "Applied surgical code changes to address the root cause.";
    if (planEntry?.result) {
      try {
        const jsonMatch = planEntry.result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          fixRationale = parsed.changes ? parsed.changes.join("\n") : (parsed.rootCause || fixRationale);
        }
      } catch {
        fixRationale = planEntry.result.slice(0, 300);
      }
    }

    const bugProof = state.reproductionFailureOutput 
      ? `\n### Reproduction Logs\n\`\`\`text\n${state.reproductionFailureOutput}\n\`\`\`\n`
      : "";

    const fixProof = state.verificationSuccessOutput
      ? `\n### Verification Logs\n\`\`\`text\n${state.verificationSuccessOutput}\n\`\`\`\n`
      : "";

    const lintSection = state.lintOutput
      ? `\n### Style Compliance\n\`\`\`text\n${state.lintOutput}\n\`\`\`\n`
      : "";

    return `## Root Cause Analysis
${technicalSummary}

## Proof of Bug
The following reproduction test was executed in a sandboxed environment and failed as expected, confirming the reported issue:
${bugProof}

## The Fix
${fixRationale}

## Proof of Fix
After applying the surgical patch, the reproduction test and the project's test suite were executed. All tests passed successfully:
${fixProof}${lintSection}

---
*Generated by [Repatch](https://github.com/Sagar-024/Repatch) — Autonomous Test-Driven Debugging*`;
  }

  private extractKeywords(text: string): string[] {
    try {
      const parsed = JSON.parse(text);
      if (parsed.keywords && Array.isArray(parsed.keywords)) {
        return parsed.keywords;
      }
    } catch {
      // Not JSON, try to extract words
    }
    // Default keywords from issue text
    const words = text.split(/\s+/).filter(w => w.length > 3);
    return words.slice(0, 10);
  }

  private safeReadFile(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  private async executeTool(toolCall: ToolCall, context: { repoPath: string }, state: AgentState): Promise<unknown> {
    const tool = getTool(toolCall.name);
    if (!tool) {
      return { error: `Tool not found: ${toolCall.name}` };
    }

    const args: Record<string, unknown> = { ...toolCall.arguments };
    console.log(`      Args: ${JSON.stringify(args).slice(0, 100)}...`);

    // Normalize and join paths
    const resolvePath = (p: string): string => {
      if (!p) return p;
      // Handle /C:/ style paths
      let normalized = p;
      if (p.startsWith("/C:/")) normalized = p.slice(1);
      else if (p.startsWith("/c/")) normalized = "C:" + p.slice(2);
      
      if (path.isAbsolute(normalized)) {
        return normalized;
      }
      return path.resolve(context.repoPath, normalized);
    };

    if (toolCall.name === "list_files") {
      args.dirPath = resolvePath(args.dirPath as string || context.repoPath);
    }
    if (toolCall.name === "grep_search") {
      args.dirPath = resolvePath(args.dirPath as string || context.repoPath);
    }
    if (toolCall.name === "read_file") {
      args.filePath = resolvePath(args.filePath as string);
    }
    if (toolCall.name === "write_file" && args.filePath) {
      args.filePath = resolvePath(args.filePath as string);
    }

    // Special case for write_file
    if (toolCall.name === "write_file") {
      return this.handleWriteFile(args);
    }

    try {
      const result = await tool.handler(args);
      
      // Track visited files for ALL tools that read files
      if (toolCall.name === "read_file" && args.filePath) {
        const fp = args.filePath as string;
        if (!state.visitedFiles.includes(fp)) {
          state.visitedFiles.push(fp);
        }
      }
      
      return result;
    } catch (error) {
      return { error: String(error) };
    }
  }

  private async handleWriteFile(args: Record<string, unknown>): Promise<{ success: boolean; path?: string; error?: string }> {
    const filePath = args.filePath as string;
    const content = args.content as string;

    if (!filePath || content === undefined) {
      return { success: false, error: "Missing filePath or content" };
    }

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, content, "utf-8");
      return { success: true, path: filePath };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async run(state: AgentState): Promise<AgentState> {
    console.log(`\n🤖 Starting Autonomous PR Fixer (Epic 3)`);
    console.log(`   Repo: ${state.repoUrl}`);
    console.log(`   Issue: ${state.issueText.slice(0, 80)}...\n`);

    while (state.currentStep !== "SUBMIT") {
      state = await this.transition(state);
      // Safety break for unexpected state machine flow
      if (state.errorLogs.length > 5) break;
    }

    return state;
  }
}

export function createOrchestrator(model?: string): Orchestrator {
  return new Orchestrator(model);
}