// State type definitions

export type Step =
  | "UNDERSTAND"
  | "EXPLORE"
  | "REPRODUCE"
  | "PLAN"
  | "EXECUTE"
  | "VERIFY"
  | "SUBMIT";

export interface AgentState {
  currentStep: Step;
  repoUrl: string;
  issueUrl: string;
  issueText: string;
  repoPath: string;
  visitedFiles: string[];
  reproductionTest?: string;
  fixPatch?: string;
  errorLogs: string[];
  history: HistoryEntry[];
}

export interface HistoryEntry {
  step: Step;
  action: string;
  result: string;
  timestamp: number;
}

export function createInitialState(
  repoUrl: string,
  issueUrl: string,
  issueText: string,
  repoPath: string
): AgentState {
  return {
    currentStep: "UNDERSTAND",
    repoUrl,
    issueUrl,
    issueText,
    repoPath,
    visitedFiles: [],
    errorLogs: [],
    history: []
  };
}