import { BaseStep, StepResult, StepDependencies } from "./base.js";
import { AgentState } from "../state.js";
import { createProvider, getToolsForLLM, LLMMessage } from "../../inference/provider.js";
import { extractKeywords } from "./utils.js";

export class ExploreStep implements BaseStep {
  readonly name = "EXPLORE";

  constructor(private deps: StepDependencies) {}

  async execute(state: AgentState): Promise<StepResult> {
    const provider = createProvider({ model: this.deps.model });
    const tools = getToolsForLLM();

    // Get initial understanding from history
    const understandEntry = state.history.find(h => h.step === "UNDERSTAND");
    const keywords = understandEntry?.result ? extractKeywords(understandEntry.result) : [];

    const hintSection = state.hint ? `\n### USER HINT:\nThe user has provided a hint: "${state.hint}". Prioritize exploring this area.\n` : "";

    const systemPrompt = `You are exploring the codebase to find relevant files for fixing a bug.

REPO PATH: ${state.repoPath}
KEYWORDS: ${keywords.join(", ")}${hintSection}

MAP OF TRUTH (File Tree):
${state.fileTree || "Not available"}

### MISSION:
Find the EXACT files that contain the bug.
1. Use 'grep_search' to find the keywords in the codebase.
2. Whenever you find a file that looks relevant, you MUST call 'read_file' to examine it.
3. You are NOT finished until you have called 'read_file' on the source files related to the bug.

### IMPORTANT:
Before every tool call, you MUST provide a "monologue" explaining your hypothesis and your next action.

Respond with JSON tool calls. The text content before the tool calls will be treated as your monologue.`;

    const messages: LLMMessage[] = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: `Find and READ the files related to the bug. Keywords: ${keywords.join(", ")}` }
    ];

    let response = await provider.complete(messages, tools);
    let iterations = 0;

    while (iterations < this.deps.maxIterations) {
      if (response.content) {
        state.monologue = response.content;
        console.log(`\n💭 Thought: ${state.monologue}`);
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
        // If we have no visited files yet, we MUST keep exploring
        if (state.visitedFiles.length === 0) {
          console.log("   ⚠️ No tool call in EXPLORE, forcing continuation...");
          messages.push({
            role: "user" as const,
            content: "You have not visited any files yet. You MUST use 'read_file' to examine the files related to the bug before you can finish this step."
          });
          response = await provider.complete(messages, tools);
          iterations++;
          continue;
        }
        break; // Exit if we have files and model is done
      }

      // E4: Parallel Tool Batching
      console.log(`   🔧 Batching ${response.toolCalls.length} tool calls...`);
      const results = await Promise.all(
        response.toolCalls.map(async (toolCall) => {
          console.log(`      🔧 ${toolCall.name}`);
          const result = await this.deps.executeTool(toolCall, state);
          return { toolCall, result };
        })
      );

      for (const { toolCall, result } of results) {
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
    
    return {
      nextStep: "REPRODUCE",
      state
    };
  }
}
