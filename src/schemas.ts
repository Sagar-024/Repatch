import { z } from "zod";

// === Review Issue ===
export const IssueSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  category: z.enum([
    "security",
    "bug",
    "performance",
    "code_quality",
    "best_practice",
    "style",
    "potential_bug",
  ]),
  description: z.string(),
  line_numbers: z.array(z.number()).optional(),
  code_snippet: z.string().optional(),
  suggested_fix: z.string().optional(),
  replacement_code: z.string().optional(),
  confidence: z.enum(["certain", "high", "medium", "low"]).optional(),
});

export type Issue = z.infer<typeof IssueSchema>;

// === Review Report ===
export const ReviewReportSchema = z.object({
  file_path: z.string(),
  issues: z.array(IssueSchema),
  summary: z.object({
    total: z.number(),
    critical: z.number(),
    high: z.number(),
    medium: z.number(),
    low: z.number(),
    info: z.number(),
  }),
  overall_verdict: z.enum(["fail", "pass_with_issues", "pass"]),
});

export type ReviewReport = z.infer<typeof ReviewReportSchema>;

// === Agent State ===
export const AgentStateSchema = z.object({
  current_step: z.string(),
  status: z.enum(["running", "completed", "error"]).default("running"),
  start_time: z.number(),
  files_reviewed: z.number().default(0),
  files_with_issues: z.number().default(0),
  total_issues_found: z.number().default(0),
  fixes_applied: z.number().default(0),
  errors: z.array(z.string()).default([]),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

// === LLM Interaction Types ===
export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  raw?: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
}

export function emptyReport(filePath: string): ReviewReport {
  return {
    file_path: filePath,
    issues: [],
    summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    overall_verdict: "pass",
  };
}

export function buildReportSummary(filePath: string, issues: Issue[]): ReviewReport {
  const summary = { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const issue of issues) {
    summary.total++;
    summary[issue.severity]++;
  }
  const verdict =
    summary.critical > 0 || summary.high > 2
      ? "fail" as const
      : summary.total > 0
        ? "pass_with_issues" as const
        : "pass" as const;

  return { file_path: filePath, issues, summary, overall_verdict: verdict };
}
