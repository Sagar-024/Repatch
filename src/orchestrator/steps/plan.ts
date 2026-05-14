import * as path from "path";
import * as fs from "fs";
import { AgentState, Step } from "../state.js";
import { BaseStep, StepDependencies, StepResult } from "./base.js";
import { createProvider, LLMMessage } from "../../inference/provider.js";

export class PlanStep implements BaseStep {
  readonly name: Step = "PLAN";

  constructor(private deps: StepDependencies) {}

  private safeReadFile(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  async execute(state: AgentState): Promise<StepResult> {
    const provider = createProvider({ model: this.deps.model });

    // RESEARCH GATE: Ensure we have actually READ the relevant files
    if (state.visitedFiles.length === 0) {
      console.log("   ⚠️ Research Gate triggered: No files visited. Forcing EXPLORE...");
      return {
        nextStep: "EXPLORE",
        state
      };
    }

    // Gather context from visited files
    const exploredFiles = state.visitedFiles.slice(0, 5).map(f => {
      const content = this.safeReadFile(f);
      return `File: ${path.basename(f)}\nFull Path: ${f}\nContent:\n${content || "Could not read"}`;
    }).join("\n\n");

    const systemPrompt = `You are a Senior Architect planning a surgical fix.

ISSUE: ${state.issueText}
HINT: ${state.hint || "None"}

MAP OF TRUTH (File Tree):
${state.fileTree || "Not available"}

EXPLORED CODEBASE CONTEXT:
${exploredFiles}

### MISSION:
1. Identify the EXACT line(s) that need to change. Use the MAP OF TRUTH to ensure you are targeting the correct files.
2. Ensure your plan is MINIMAL.
3. If you do not see the source code for the file that needs fixing in the CONTEXT above, you MUST respond with: "I need to read [file path] before I can plan."

Respond with a JSON plan:
{"monologue": "Explain your hypothesis and plan here.", "rootCause": "...", "filesToModify": [...], "changes": ["line 1 -> new line 1", ...], "verification": "..."}`;

    const messages: LLMMessage[] = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: "Create the fix plan based on the explored code." }
    ];

    const response = await provider.complete(messages);
    
    // Extract monologue if present in JSON or content
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.monologue) {
          state.monologue = parsed.monologue;
          console.log(`\n💭 Thought: ${state.monologue}`);
        }
      } else if (response.content) {
        state.monologue = response.content;
        console.log(`\n💭 Thought: ${state.monologue}`);
      }
    } catch {
       if (response.content) {
         state.monologue = response.content;
         console.log(`\n💭 Thought: ${state.monologue}`);
       }
    }

    // Check if model is asking for more files
    if (response.content.toLowerCase().includes("need to read")) {
       console.log("   ⚠️ Model requested more context. Backtracking to EXPLORE...");
       return {
         nextStep: "EXPLORE",
         state
       };
    }

    state.history.push({
      step: this.name,
      action: "Created fix plan",
      result: response.content.slice(0, 500),
      timestamp: Date.now()
    });

    return {
      nextStep: "EXECUTE",
      state
    };
  }
}
