import { AgentState, Step } from "../state.js";
import { ToolCall } from "../../inference/provider.js";

export interface StepResult {
  nextStep: Step;
  state: AgentState;
}

export interface StepDependencies {
  model: string;
  maxIterations: number;
  isLocal?: boolean;
  executeTool(toolCall: ToolCall, state: AgentState): Promise<unknown>;
}

export interface BaseStep {
  readonly name: Step;
  execute(state: AgentState): Promise<StepResult>;
}
