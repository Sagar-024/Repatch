
import { AgentState, Step, HistoryEntry, createInitialState } from "./state.js";
import { getDefaultModel, ToolCall } from "../inference/provider.js";
import { getTool } from "../tools/registry.js";
import { logger } from "../utils/logger.js";
import * as fs from "fs";
import * as path from "path";

import { BaseStep, StepDependencies } from "./steps/base.js";
import { UnderstandStep } from "./steps/understand.js";
import { ExploreStep } from "./steps/explore.js";
import { ReproduceStep } from "./steps/reproduce.js";
import { PlanStep } from "./steps/plan.js";
import { ExecuteStep } from "./steps/execute.js";
import { VerifyStep } from "./steps/verify.js";
import { SubmitStep } from "./steps/submit.js";

import { PersistenceMiddleware } from "./middleware/persistence.js";

export interface StateMachine {
  transition(state: AgentState): Promise<AgentState>;
}

export class Orchestrator implements StateMachine {
  private model: string;
  private maxIterationsPerStep: number;
  private persistence?: PersistenceMiddleware;
  private isLocal: boolean;

  constructor(model?: string, options: { maxIterationsPerStep?: number; isLocal?: boolean } = {}) {
    this.model = model || getDefaultModel();
    this.maxIterationsPerStep = options.maxIterationsPerStep || 5;
    this.isLocal = options.isLocal || false;
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
      isLocal: this.isLocal,
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
    logger.info(`Step: ${stepName}`);
    
    try {
      const step = this.getStep(stepName);
      const result = await step.execute(state);
      state = result.state;
      state.currentStep = result.nextStep;

      if (this.persistence) {
        await this.persistence.save(state);
      }
      
      return state;
    } catch (error) {
      logger.fail(`Error in ${stepName}: ${error}`);
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
    logger.debug(`Args: ${JSON.stringify(args).slice(0, 100)}...`);

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
    if (toolCall.name === "edit_file" && args.filePath) {
      args.filePath = resolvePath(args.filePath as string);
    }

    if ((toolCall.name === "write_file" || toolCall.name === "edit_file") && args.filePath) {
      const resolved = path.resolve(args.filePath as string);
      const repoRoot = path.resolve(context.repoPath);
      if (!resolved.startsWith(repoRoot + path.sep) && resolved !== repoRoot) {
        return { error: `Path traversal denied: "${resolved}" is outside the repository directory "${repoRoot}"` };
      }
    }
    if (toolCall.name === "create_reproduction_test" && args.dirPath) {
      args.dirPath = resolvePath(args.dirPath as string);
    }
    if (toolCall.name === "run_command") {
      args.repoPath = context.repoPath;
    }




    if (toolCall.name === "write_file") {
      return this.handleWriteFile(args);
    }

    try {
      const result = await tool.handler(args);
      
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
    logger.info(`Starting Autonomous PR Fixer`);
    logger.info(`Repo: ${state.repoUrl}`);
    logger.info(`Issue: ${state.issueText.slice(0, 80)}...`);

    const { generateFileTree } = await import("./utils.js");
    logger.start(`Generating Map of Truth...`);
    state.fileTree = generateFileTree(state.repoPath);
    logger.succeed(`Map of Truth generated.`);

    const maxSteps = 20;
    let stepCount = 0;

    while (stepCount < maxSteps) {
      const currentStepName = state.currentStep;
      state = await this.transition(state);
      stepCount++;

      // SUBMIT transitions to itself when done
      if (currentStepName === "SUBMIT" && state.currentStep === "SUBMIT") {
        break;
      }
      
      if (state.errorLogs.length > 10) {
        logger.fail("Too many errors, halting.");
        break;
      }
    }

    return state;
  }
}

export function createOrchestrator(model?: string): Orchestrator {
  return new Orchestrator(model);
}