import { AgentState, Step } from "../state.js";
import { BaseStep, StepDependencies, StepResult } from "./base.js";
import { createProvider, getToolsForLLM, LLMMessage } from "../../inference/provider.js";

export class ReproduceStep implements BaseStep {
  readonly name: Step = "REPRODUCE";

  constructor(private deps: StepDependencies) {}

  async execute(state: AgentState): Promise<StepResult> {
    const provider = createProvider({ model: this.deps.model });
    const tools = getToolsForLLM();
    const toolContext = { repoPath: state.repoPath };

    const systemPrompt = `You are reproducing the bug in a local sandbox.

REPO PATH: ${state.repoPath}

MAP OF TRUTH (File Tree):
${state.fileTree || "Not available"}

### MISSION:
1. READ the relevant files to understand the current logic. Use the MAP OF TRUTH to guide your search.
2. Author a dedicated reproduction test using 'create_reproduction_test' that PROVES the bug exists.
3. Use 'run_command' to execute the authored test and confirm it fails.

### IMPORTANT:
The most important artifact from this step is the reproduction test file. You MUST author it.

Before every tool call, you MUST provide a "monologue" explaining your hypothesis and your next action.

You MUST call 'read_file' if you haven't seen the content of the relevant files yet.

Respond with JSON tool calls. The text content before the tool calls will be treated as your monologue.`;

    const messages: LLMMessage[] = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: "Reproduce the bug now. Read files and run commands." }
    ];

    let iterations = 0;
    while (iterations < this.deps.maxIterations) {
      const response = await provider.complete(messages, tools);

      if (response.content) {
        state.monologue = response.content;
        console.log(`\n💭 Thought: ${state.monologue}`);
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
        if (!state.reproductionTest) {
          console.log("   ⚠️ No tool call in REPRODUCE, forcing continuation...");
          messages.push({
            role: "user" as const,
            content: "You have not run a reproduction command yet. You MUST use 'run_command' to prove the bug exists before you can finish this step."
          });
          iterations++;
          continue;
        }
        break;
      }

      for (const toolCall of response.toolCalls) {
        console.log(`   🔧 ${toolCall.name}`);
        const result = await this.deps.executeTool(toolCall, state);

        messages.push({ role: "assistant" as const, content: `[Called ${toolCall.name}]` });
        messages.push({ role: "user" as const, content: `Result: ${JSON.stringify(result).slice(0, 500)}` });

        if (toolCall.name === "run_command") {
          state.reproductionTest = toolCall.arguments.cmd as string;
          const cmdResult = result as { stdout: string; stderr: string; exitCode: number };
          if (cmdResult.exitCode !== 0) {
            state.reproductionFailureOutput = `STDOUT:\n${cmdResult.stdout}\nSTDERR:\n${cmdResult.stderr}`;
          }
        }
      }
      iterations++;
    }

    state.history.push({
      step: this.name,
      action: "Attempted reproduction",
      result: `Reproduction test: ${state.reproductionTest || "None"}`,
      timestamp: Date.now()
    });

    return {
      nextStep: "PLAN",
      state
    };
  }
}
