import { AgentState, Step } from "../state.js";
import { BaseStep, StepDependencies, StepResult } from "./base.js";
import { createProvider, LLMMessage } from "../../inference/provider.js";
import { getToolsForLLM } from "../../inference/provider.js";
import * as fs from "fs";
import * as path from "path";

export class ExecuteStep implements BaseStep {
  readonly name: Step = "EXECUTE";

  constructor(private deps: StepDependencies) {}

  private safeReadFile(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * Fuzzy Surgical Matching: Match code by intent (ignoring whitespace/semicolons)
   */
  private fuzzyReplace(content: string, oldSnippet: string, newSnippet: string): string | null {
    const normalize = (s: string) => s.replace(/[\s;]/g, "");
    const normalizedOld = normalize(oldSnippet);
    
    if (!normalizedOld) return null;

    // Sliding window search for normalized match
    for (let i = 0; i <= content.length - oldSnippet.length * 0.5; i++) {
      // We don't know the exact length of the match in the original content
      // but it should be roughly similar to oldSnippet length.
      // Let's try expanding windows.
      for (let len = Math.floor(oldSnippet.length * 0.5); len <= oldSnippet.length * 2; len++) {
        if (i + len > content.length) break;
        
        const chunk = content.slice(i, i + len);
        if (normalize(chunk) === normalizedOld) {
          return content.slice(0, i) + newSnippet + content.slice(i + len);
        }
      }
    }

    return null;
  }

  async execute(state: AgentState): Promise<StepResult> {
    const provider = createProvider({ model: this.deps.model, temperature: 0 });
    const tools = getToolsForLLM().filter(t => ["edit_file", "write_file", "run_command"].includes(t.name));

    const planEntry = state.history.find(h => h.step === "PLAN");
    
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
1. SURGICAL EDITS: Use the 'edit_file' tool to apply changes. Do NOT rewrite the whole file unless creating a new one.
2. EXACT MATCH: 'edit_file' requires an EXACT match of the 'oldSnippet'. Include correct indentation and line endings.
3. NO EXPLORATION: You have the FULL CONTENT of the relevant files below. Do NOT attempt to read them again.
4. NO CHAT: Do not explain your actions in chat. Use the 'monologue' principle instead.
5. IMMEDIATE ACTION: Your response must include the tool call(s) required to fulfill the PLAN.

### IMPORTANT:
Before every tool call, you MUST provide a "monologue" explaining your hypothesis and your next action.

### CONTEXT:
ISSUE: ${state.issueText}
PLAN: ${planEntry?.result || "No explicit plan"}${fileContext}

### EXECUTION:
Apply the fix to the relevant file(s) NOW using 'edit_file'. Respond with JSON tool calls. The text content before the tool calls will be treated as your monologue.`;

    const messages: LLMMessage[] = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: "Apply the fix described in the PLAN immediately using edit_file." }
    ];

    let iterations = 0;
    let appliedChanges = 0;

    while (iterations < this.deps.maxIterations) {
      const response = await provider.complete(messages, tools);

      if (response.content) {
        state.monologue = response.content;
        console.log(`\n💭 Thought: ${state.monologue}`);
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
        if (appliedChanges === 0 && iterations === 0) {
          console.log("   ⚠️ No tool call detected, retrying...");
          messages.push({
            role: "user" as const,
            content: "CRITICAL ERROR: No tool call detected. You MUST call 'edit_file' or 'write_file' to apply the fix described in the PLAN. Do not provide text explanations. Respond ONLY with the tool call."
          });
          iterations++;
          continue;
        }
        break;
      }

      for (const toolCall of response.toolCalls) {
        console.log(`   🔧 ${toolCall.name}`);
        
        let result: any;
        
        // Intercept edit_file for Fuzzy Matching
        if (toolCall.name === "edit_file") {
          const { filePath, oldSnippet, newSnippet } = toolCall.arguments as any;
          const content = this.safeReadFile(filePath);
          
          if (content) {
            // Try exact match first (standard tool behavior)
            if (content.includes(oldSnippet)) {
              result = await this.deps.executeTool(toolCall, state);
            } else {
              // Try fuzzy match
              console.log(`   ✨ Attempting Fuzzy Match for ${path.basename(filePath)}...`);
              const newContent = this.fuzzyReplace(content, oldSnippet, newSnippet);
              if (newContent) {
                fs.writeFileSync(filePath, newContent, "utf-8");
                result = { success: true, fuzzy: true };
                console.log(`   ✅ Fuzzy Match success!`);
              } else {
                result = { success: false, error: "Snippet not found even with fuzzy matching." };
              }
            }
          } else {
            result = { success: false, error: "File not found." };
          }
        } else {
          result = await this.deps.executeTool(toolCall, state);
        }

        if (result && (result.success || result.path)) {
          appliedChanges++;
        } else {
          const errorMsg = result?.error || "Unknown error";
          console.error(`   ❌ Tool failed: ${errorMsg}`);
          state.errorLogs.push(`Execution tool failed (${toolCall.name}): ${errorMsg}`);
        }

        messages.push({ role: "assistant" as const, content: `[Called ${toolCall.name}]` });
        messages.push({ role: "user" as const, content: `Result: ${JSON.stringify(result).slice(0, 500)}` });

        if (toolCall.name === "edit_file" || toolCall.name === "write_file") {
          if (result && (result.success || result.path)) {
            state.fixPatch = (state.fixPatch || "") + `\n${toolCall.name}: ${JSON.stringify(toolCall.arguments)}`;
          }
        }
      }
      iterations++;
    }

    state.history.push({
      step: this.name,
      action: "Applied fixes",
      result: appliedChanges > 0 ? `Applied ${appliedChanges} changes` : "Failed to apply any changes",
      timestamp: Date.now()
    });

    return {
      nextStep: appliedChanges > 0 ? "VERIFY" : "PLAN", // Backtrack to PLAN if nothing was applied
      state
    };
  }
}
