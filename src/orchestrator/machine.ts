// State machine stub - Epic 2+ implementation
// Placeholder for LangGraph state machine

import { AgentState, Step } from "./state.js";

export interface StateMachine {
  transition(state: AgentState): Promise<AgentState>;
  getNextStep(currentStep: Step): Step;
}

export class Orchestrator implements StateMachine {
  async transition(state: AgentState): Promise<AgentState> {
    // Epic 2+ implementation
    return state;
  }

  getNextStep(currentStep: Step): Step {
    // Epic 2+ implementation
    return "UNDERSTAND";
  }
}

export function createOrchestrator(): Orchestrator {
  return new Orchestrator();
}