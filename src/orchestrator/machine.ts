// State machine - Epic 3: The Inviolable Loop
// Decoupled Step Pattern (Strategy Pattern)

import { AgentState, Step, HistoryEntry, createInitialState } from "./state.js";
import { getDefaultModel, ToolCall } from "../inference/provider.js";
import { getTool } from "../tools/registry.js";
import * as fs from "fs";
import * as path from "path";

// Step Imports
import { BaseStep, StepDependencies } from "./steps/base.js";
import { UnderstandStep } from "./steps/understand.js";
import { ExploreStep } from "./steps/explore.js";
import { ReproduceStep } from "./steps/reproduce.js";
import { PlanStep } from "./steps/plan.js";
import { ExecuteStep } from "./steps/execute.js";
import { VerifyStep } from "./steps/verify.js";
import { SubmitStep } from "./steps/submit.js";

// Middleware
import { PersistenceMiddleware } from "./middleware/persistence.js";

export interface StateMachine {
  transition(state: AgentState): Promise<AgentState>;
}

export class Orchestrator implements StateMachine {
  private model: string;
  private maxIterationsPerStep: number;
  private persistence?: PersistenceMiddleware;

  constructor(model?: string, maxIterationsPerStep = 5) {
    this.model = model || getDefaultModel();
    this.maxIterationsPerStep = maxIterationsPerStep;
  }

  private initPersistence(repoPath: string) {
    if (!this.persistence) {
      this.persistence = new PersistenceMiddleware(repoPath);
    }
  }

  private getStep(step: Step): BaseStep {
    const deps: StepDependencies = {
      model: this.model,
      maxIterations: this.maxIterationsPerStep,
      executeTool: (toolCall, state) => this.executeTool(toolCall, { repoPath: state.repoPath }, state)
    };

    switch (step) {
      case "UNDERSTAND": return new UnderstandStep(deps);
      case "EXPLORE": return new ExploreStep(deps);
      case "REPRODUCE": return new ReproduceStep(deps);
      case "PLAN": return new PlanStep(deps);
      case "EXECUTE": return new ExecuteStep(deps);
      case "VERIFY": return new VerifyStep(deps);
      case "SUBMIT": return new SubmitStep(deps);
      default: throw new Error(`Unknown step: ${step}`);
    }
  }

  async transition(state: AgentState): Promise<AgentState> {
    this.initPersistence(state.repoPath);
    const stepName = state.currentStep;
    console.log(`\n📍 Step: ${stepName}`);
    
    try {
      const step = this.getStep(stepName);
      const result = await step.execute(state);
      state = result.state;
      state.currentStep = result.nextStep;

      // Auto-save checkpoint
      if (this.persistence) {
        await this.persistence.save(state);
      }
      
      return state;
    } catch (error) {
      console.error(`   ❌ Error in ${stepName}: ${error}`);
      state.errorLogs.push(`Error in ${stepName}: ${error}`);
      return state;
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
    if (toolCall.name === "edit_file" && args.filePath) {
      args.filePath = resolvePath(args.filePath as string);
    }

    // Special case for write_file
    if (toolCall.name === "write_file") {
      return this.handleWriteFile(args);
    }

    try {
      const result = await tool.handler(args);
      
      // Track visited files
      if (toolCall.name === "read_file" && args.filePath) {
        const fp = args.filePath as string;
        if (!state.visitedFiles.includes(fp)) {
          state.visitedFiles.push(fp);
        }
      }

      if (toolCall.name === "grep_search" && result && typeof result === "object") {
        const grepResult = result as { matches?: Array<{ file: string }> };
        if (grepResult.matches && Array.isArray(grepResult.matches)) {
          for (const match of grepResult.matches) {
            const fp = resolvePath(match.file);
            if (!state.visitedFiles.includes(fp)) {
              state.visitedFiles.push(fp);
            }
          }
        }
      }

      if (toolCall.name === "edit_file" || toolCall.name === "write_file") {
        state.fixPatch = (state.fixPatch || "") + `\n${toolCall.name}: ${JSON.stringify(toolCall.arguments)}`;
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
    console.log(`\n🤖 Starting Autonomous PR Fixer (V1 Decoupled)`);
    console.log(`   Repo: ${state.repoUrl}`);
    console.log(`   Issue: ${state.issueText.slice(0, 80)}...\n`);

    // Generate Map of Truth
    const { generateFileTree } = await import("./utils.js");
    console.log(`   🗺️ Generating Map of Truth...`);
    state.fileTree = generateFileTree(state.repoPath);

    const maxSteps = 20; // Prevent infinite loops
    let stepCount = 0;

    // The loop continues until a terminal condition or max steps reached.
    // In this V1 refactor, SUBMIT is the final step, but it transitions to itself or finishes.
    // We'll use a special condition or just let it run until it stops changing state or reaches SUBMIT and completes.
    
    let previousStep: Step | null = null;
    
    while (stepCount < maxSteps) {
      const currentStepName = state.currentStep;
      state = await this.transition(state);
      stepCount++;

      // If SUBMIT step is completed, we are done.
      // In SUBMIT.execute, it returns nextStep: "SUBMIT".
      // We'll check if we've already executed SUBMIT.
      if (currentStepName === "SUBMIT" && state.currentStep === "SUBMIT") {
        break;
      }
      
      if (state.errorLogs.length > 10) {
        console.error("   ❌ Too many errors, halting.");
        break;
      }
    }

    return state;
  }
}

export function createOrchestrator(model?: string): Orchestrator {
  return new Orchestrator(model);
}
