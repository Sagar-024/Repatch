import { BaseStep, StepResult, StepDependencies } from "./base.js";
import { AgentState } from "../state.js";
import { createProvider, LLMMessage } from "../../inference/provider.js";

export class UnderstandStep implements BaseStep {
  readonly name = "UNDERSTAND";

  constructor(private deps: StepDependencies) {}

  async execute(state: AgentState): Promise<StepResult> {
    const provider = createProvider({ model: this.deps.model });

    const systemPrompt = `You are a Senior Software Engineer triaging a bug report.

REPO: ${state.repoUrl}
ISSUE: ${state.issueText}

MAP OF TRUTH (File Tree):
${state.fileTree || "Not available"}

Your task is to:
1. Summarize the bug with technical precision.
2. Identify the authoritative source for this logic (e.g., Wikipedia for phone plans, Unicode docs, MDN, etc.).
3. Determine key keywords and likely files based on the MAP OF TRUTH.

Respond with a JSON object:
{"summary": "...", "references": ["url1", "url2"], "keywords": [...], "analysis": "..."}`;

    const messages: LLMMessage[] = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: "Analyze this issue. If it involves international standards (phone, currency, etc.), find a likely reference URL." }
    ];

    const response = await provider.complete(messages);

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.references) state.references = parsed.references;
      }
    } catch {
      // Fallback if parsing fails
    }

    state.history.push({
      step: "UNDERSTAND",
      action: "Analyzed issue",
      result: response.content,
      timestamp: Date.now()
    });

    console.log(`   ✅ Understanding complete.`);
    
    return {
      nextStep: "EXPLORE",
      state
    };
  }
}
