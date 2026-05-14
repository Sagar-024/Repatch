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
  fileTree?: string; // The "Map of Truth"
  monologue?: string; // The "Internal Monologue"
  visitedFiles: string[];
  reproductionTest?: string;
  reproductionFailureOutput?: string;
  verificationSuccessOutput?: string;
  lintOutput?: string;
  hint?: string;
  references?: string[];
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
  repoPath: string,
  hint?: string
): AgentState {
  return {
    currentStep: "UNDERSTAND",
    repoUrl,
    issueUrl,
    issueText,
    repoPath,
    visitedFiles: [],
    hint,
    errorLogs: [],
    history: []
  };
}