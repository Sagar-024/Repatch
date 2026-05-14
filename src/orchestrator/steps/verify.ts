import { AgentState, Step } from "../state.js";
import { BaseStep, StepDependencies, StepResult } from "./base.js";
import { createProvider, LLMMessage } from "../../inference/provider.js";
import { getToolsForLLM } from "../../inference/provider.js";
import { detectLintCommand, detectFormatCommand } from "../../sandbox/lint.js";

export class VerifyStep implements BaseStep {
  readonly name: Step = "VERIFY";

  constructor(private deps: StepDependencies) {}

  async execute(state: AgentState): Promise<StepResult> {
    const provider = createProvider({ model: this.deps.model });
    const tools = getToolsForLLM();

    const systemPrompt = `You are verifying that the fix works.

REPO PATH: ${state.repoPath}

MAP OF TRUTH (File Tree):
${state.fileTree || "Not available"}

### MISSION:
1. You MUST run the tests to verify the fix. Use the MAP OF TRUTH to find the correct test files.
2. Use 'run_command' to execute the reproduction test or any other relevant tests.
3. If tests fail, you must analyze why.
4. You are NOT finished until you have proof that the fix works.

### IMPORTANT:
Before every tool call, you MUST provide a "monologue" explaining your hypothesis and your next action.

Use run_command to verify the fix. Respond with JSON tool calls. The text content before the tool calls will be treated as your monologue.`;

    const messages: LLMMessage[] = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: "Verify that the fix works by running tests or the application." }
    ];

    let iterations = 0;
    let testsPassed = false;

    while (iterations < this.deps.maxIterations) {
      const response = await provider.complete(messages, tools);
      
      if (response.content) {
        state.monologue = response.content;
        console.log(`\n💭 Thought: ${state.monologue}`);
      }

      if (!response.toolCalls || response.toolCalls.length === 0) break;

      for (const toolCall of response.toolCalls) {
        console.log(`   🔧 ${toolCall.name}`);
        const result = await this.deps.executeTool(toolCall, state);

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
      iterations++;
    }

    // Automatic Style Compliance & Linter Verification
    if (testsPassed) {
      // 1. Auto-Format
      const formatCmd = detectFormatCommand(state.repoPath);
      if (formatCmd) {
        console.log(`   🔧 Running formatter: ${formatCmd}`);
        await this.deps.executeTool({
          name: "run_command",
          arguments: { cmd: formatCmd, imageTag: "pr-fixer-sandbox:latest" }
        }, state);
      }

      // 2. Lint Check
      const lintCmd = detectLintCommand(state.repoPath);
      if (lintCmd) {
        console.log(`   🔧 Running linter: ${lintCmd}`);
        const lintResult = await this.deps.executeTool({
          name: "run_command",
          arguments: { cmd: lintCmd, imageTag: "pr-fixer-sandbox:latest" }
        }, state) as { stdout: string; stderr: string; exitCode: number };

        state.lintOutput = `STDOUT:\n${lintResult.stdout}\nSTDERR:\n${lintResult.stderr}`;

        if (lintResult.exitCode !== 0) {
          console.log(`   ❌ Linting failed. Backtracking to PLAN.`);
          state.errorLogs.push(`Linting failed: ${lintResult.stderr}`);
          return {
            nextStep: "PLAN",
            state
          };
        }
        console.log(`   ✅ Linting passed.`);
      } else {
        console.log(`   ℹ️ No linter detected.`);
      }
    }

    state.history.push({
      step: this.name,
      action: "Verified fix",
      result: testsPassed ? "Tests passed" : "Tests failed",
      timestamp: Date.now()
    });

    return {
      nextStep: "SUBMIT",
      state
    };
  }
}
