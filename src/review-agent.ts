import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";
import { createProvider, getDefaultModel, LLMProvider } from "./inference/provider.js";

interface ReviewIssue {
  severity: "critical" | "high" | "medium" | "low" | "info"
  category: "security" | "bug" | "performance" | "code_quality" | "best_practice" | "potential_bug"
  description: string
  line_numbers?: number[]
  code_snippet?: string
  suggested_fix?: string
  replacement_code?: string
  confidence?: "certain" | "high" | "medium" | "low"
}

interface ReviewReport {
  file_path: string
  issues: ReviewIssue[]
  summary: { total: number; critical: number; high: number; medium: number; low: number; info: number }
  overall_verdict: "fail" | "pass_with_issues" | "pass"
}

const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m', BOLD = '\x1b[1m', DIM = '\x1b[2m', RESET = '\x1b[0m'
const severityColor = (s: string) => s === 'critical' ? RED : s === 'high' ? YELLOW : s === 'medium' ? CYAN : GREEN
const severityIcon = (s: string) => s === 'critical' ? '🔴' : s === 'high' ? '🟡' : s === 'medium' ? '🔵' : s === 'low' ? '🟢' : '⚪'

function buildSummary(issues: ReviewIssue[]): ReviewReport['summary'] {
  const summary = { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const i of issues) { summary.total++; (summary as any)[i.severity]++; }
  return summary;
}

function verdictFrom(summary: ReviewReport['summary']): "fail" | "pass_with_issues" | "pass" {
  if (summary.critical > 0 || summary.high > 2) return "fail";
  if (summary.total > 0) return "pass_with_issues";
  return "pass";
}

function emptyReport(filePath: string): ReviewReport {
  return {
    file_path: filePath,
    issues: [],
    summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    overall_verdict: "pass",
  };
}

export class ReviewAgent {
  private provider: LLMProvider;

  constructor(model?: string) {
    this.provider = createProvider({ model: model || getDefaultModel() });
  }

  async run(filePath: string): Promise<ReviewReport> {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const content = fs.readFileSync(absolutePath, 'utf-8');
    let report: ReviewReport;
    try {
      console.log(`${BOLD}${CYAN}🔍 Analyzing: ${path.basename(filePath)}${RESET}`);
      report = await this.analyze(filePath, content);
    } catch (error) {
      console.log(`${YELLOW}⚠ Gemini analysis failed, falling back to static analysis...${RESET}`);
      report = this.staticAnalysis(content, filePath);
    }
    if (report.issues.length > 0) {
      await this.applyFixes(absolutePath, report);
    }
    this.printReport(report);
    return report;
  }

  async runGlob(pattern: string): Promise<ReviewReport[]> {
    const files = glob.sync(pattern);
    const reports: ReviewReport[] = [];
    for (const file of files) {
      if (fs.statSync(file).isFile()) {
        reports.push(await this.run(file));
      }
    }
    if (reports.length > 1) {
      console.log(`\n${BOLD}--- BATCH SUMMARY ---${RESET}`);
      console.log(`${BOLD}${'File'.padEnd(40)} | ${'Issues'.padEnd(8)} | ${'Verdict'}${RESET}`);
      console.log(`${DIM}${''.padEnd(40, '-')}---${''.padEnd(8, '-')}---${''.padEnd(10, '-')}${RESET}`);
      for (const r of reports) {
        const vColor = r.overall_verdict === 'fail' ? RED : r.overall_verdict === 'pass' ? GREEN : YELLOW;
        console.log(`${path.basename(r.file_path).padEnd(40)} | ${String(r.summary.total).padEnd(8)} | ${vColor}${r.overall_verdict.toUpperCase()}${RESET}`);
      }
    }
    return reports;
  }

  private async analyze(filePath: string, content: string): Promise<ReviewReport> {
    const systemPrompt = `Act as a senior security and code quality reviewer.
Analyze the code for: security vulnerabilities, bugs, performance issues, code quality problems.
Return findings in a specific JSON format inside \`\`\`json code blocks.

JSON Format:
{
  "issues": [
    {
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "category": "security" | "bug" | "performance" | "code_quality" | "best_practice" | "potential_bug",
      "description": "...",
      "line_numbers": [1, 2],
      "code_snippet": "...",
      "suggested_fix": "...",
      "replacement_code": "...",
      "confidence": "certain" | "high" | "medium" | "low"
    }
  ]
}`;

    const userPrompt = `File Content to Analyze (${filePath}):\n\n${content}`;
    const response = await this.provider.complete([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]);

    let issues: ReviewIssue[] = [];
    const text = response.content;

    // Try extracting JSON from ```json code block
    const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
    if (jsonBlockMatch) {
      try {
        const parsed = JSON.parse(jsonBlockMatch[1].trim());
        if (parsed.issues && Array.isArray(parsed.issues)) issues = parsed.issues;
      } catch {}
    }

    // Try finding { "issues": [...] } anywhere in text
    if (issues.length === 0) {
      const looseMatch = text.match(/\{\s*"issues"\s*:\s*\[[\s\S]*?\]\s*\}/);
      if (looseMatch) {
        try {
          const parsed = JSON.parse(looseMatch[0]);
          if (parsed.issues && Array.isArray(parsed.issues)) issues = parsed.issues;
        } catch {}
      }
    }

    // Try entire response as JSON
    if (issues.length === 0) {
      try {
        const parsed = JSON.parse(text);
        if (parsed.issues && Array.isArray(parsed.issues)) issues = parsed.issues;
      } catch {}
    }

    issues = issues.filter(i => i.severity && i.description);
    if (issues.length === 0) return emptyReport(filePath);
    const summary = buildSummary(issues);
    return { file_path: filePath, issues, summary, overall_verdict: verdictFrom(summary) };
  }

  private staticAnalysis(content: string, filePath: string): ReviewReport {
    const issues: ReviewIssue[] = [];
    const findMatches = (regex: RegExp, severity: ReviewIssue['severity'], category: ReviewIssue['category'], description: string) => {
      let match;
      const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
      while ((match = re.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        issues.push({
          severity,
          category,
          description,
          line_numbers: [lineNum],
          code_snippet: match[0],
          confidence: "medium"
        });
      }
    };

    findMatches(/\beval\s*\(/g, "high", "security", "Avoid using eval() due to security risks.");
    findMatches(/\b(exec|execSync|spawn)\s*\(/g, "high", "security", "Potential command injection risk with process execution.");
    findMatches(/\bnew\s+Function\s*\(/g, "medium", "security", "Avoid 'new Function()' as it is a form of eval.");
    findMatches(/(apiKey|secret|password|token)\s*[:=]\s*["'][^"']{4,}["']/gi, "medium", "security", "Possible hardcoded secret or credential.");
    findMatches(/\/\/\s*(TODO|FIXME|HACK|XXX)/gi, "info", "code_quality", "Technical debt marker found.");

    if (!filePath.toLowerCase().includes('test') && !filePath.toLowerCase().includes('spec')) {
      findMatches(/console\.(log|debug)\s*\(/g, "low", "best_practice", "Remove debug logs before production code.");
    }

    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      findMatches(/:\s*any\b/g, "low", "code_quality", "Avoid using 'any' type in TypeScript.");
    }

    if (issues.length === 0) return emptyReport(filePath);
    const summary = buildSummary(issues);
    return { file_path: filePath, issues, summary, overall_verdict: verdictFrom(summary) };
  }

  private async applyFixes(filePath: string, report: ReviewReport): Promise<number> {
    let content = fs.readFileSync(filePath, 'utf-8');
    let fixCount = 0;
    let modified = false;

    for (const issue of report.issues) {
      if (!issue.replacement_code || !issue.code_snippet) continue;

      let applied = false;
      if (issue.line_numbers && issue.line_numbers.length > 0) {
        const lines = content.split('\n');
        const lineIdx = issue.line_numbers[0] - 1;
        if (lines[lineIdx] && lines[lineIdx].includes(issue.code_snippet)) {
          lines[lineIdx] = lines[lineIdx].replace(issue.code_snippet, issue.replacement_code);
          content = lines.join('\n');
          applied = true;
        }
      }

      if (!applied && content.includes(issue.code_snippet)) {
        content = content.split(issue.code_snippet).join(issue.replacement_code);
        applied = true;
      }

      if (applied) {
        fixCount++;
        modified = true;
        console.log(`${GREEN}  ✔ Applied fix: ${issue.description.substring(0, 60)}${RESET}`);
      }
    }

    if (modified) fs.writeFileSync(filePath, content, 'utf-8');
    return fixCount;
  }

  private printReport(report: ReviewReport): void {
    if (report.issues.length === 0) {
      console.log(`${GREEN}${BOLD}✨ No issues found in ${path.basename(report.file_path)}!${RESET}\n`);
      return;
    }

    console.log(`\n${BOLD}${CYAN}📄 Report for ${report.file_path}${RESET}`);
    for (const issue of report.issues) {
      const color = severityColor(issue.severity);
      const icon = severityIcon(issue.severity);
      const lineText = issue.line_numbers?.length ? ` [L${issue.line_numbers.join(', ')}]` : '';
      console.log(`${icon} ${color}${BOLD}${issue.severity.toUpperCase()}${RESET} [${issue.category}]: ${issue.description}${DIM}${lineText}${RESET}`);
    }

    const s = report.summary;
    const vColor = report.overall_verdict === 'fail' ? RED : report.overall_verdict === 'pass' ? GREEN : YELLOW;
    console.log(`\n${BOLD}Summary:${RESET} Total: ${s.total} | ${RED}Crit: ${s.critical}${RESET} | ${YELLOW}High: ${s.high}${RESET} | ${CYAN}Med: ${s.medium}${RESET} | ${GREEN}Low: ${s.low}${RESET} | ${DIM}Info: ${s.info}${RESET}`);
    console.log(`${BOLD}Verdict: ${vColor}${report.overall_verdict.toUpperCase()}${RESET}\n`);
  }

  static async runGlob(pattern: string, model?: string): Promise<ReviewReport[]> {
    return new ReviewAgent(model).runGlob(pattern);
  }

  static async run(filePath: string, model?: string): Promise<ReviewReport> {
    return new ReviewAgent(model).run(filePath);
  }
}
