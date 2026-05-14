import * as fs from "fs";
import * as path from "path";
import * as readline from "readline/promises";
import { AgentState, Step } from "../state.js";
import { BaseStep, StepDependencies, StepResult } from "./base.js";
import { createProvider } from "../../inference/provider.js";
import { createBranch, commitChanges, pushBranch, getDefaultBranch, setRemoteUrl, getModifiedFiles, getDiff, getDiffStat } from "../../adapters/git.js";
import { createPullRequest, forkRepository } from "../../adapters/github.js";

export class SubmitStep implements BaseStep {
  readonly name: Step = "SUBMIT";

  constructor(private deps: StepDependencies) {}

  async execute(state: AgentState): Promise<StepResult> {
    console.log(`   📝 Drafting Engineering Narrative...`);

    const diff = await getDiff(state.repoPath);
    if (!diff || diff.trim().length < 10) {
      console.error(`   ❌ Verification failed: The actual git diff is empty or too small. Submission aborted.`);
      state.errorLogs.push("Verification failed: The actual git diff is empty or too small.");
      return { nextStep: "SUBMIT", state };
    }

    const template = this.findPRTemplate(state.repoPath);
    let narrative = "";
    
    if (template) {
      console.log(`   📄 PR Template detected. Mapping narrative to template...`);
      narrative = await this.populateTemplate(state, template, diff);
    } else {
      narrative = await this.generateNarrative(state, diff);
    }
    
    let prTitle = "fix: address logic error in source code";
    const understandEntry = state.history.find(h => h.step === "UNDERSTAND");
    if (understandEntry?.result) {
      try {
        const jsonMatch = understandEntry.result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.summary) {
            const cleanSummary = parsed.summary
              .toLowerCase()
              .replace(/the\s/g, "")
              .replace(/is\s/g, "")
              .replace(/incorrectly\s/g, "")
              .replace(/returns\sfalse/g, "")
              .slice(0, 50);
            prTitle = `fix: ${cleanSummary}`;
          }
        }
      } catch {
        prTitle = `fix: update logic for issue reported`;
      }
    }
    
    const resultsDir = path.join(process.cwd(), "results");
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    const resultPath = path.join(resultsDir, `repatch-fix-${Date.now()}.md`);
    fs.writeFileSync(resultPath, narrative, "utf-8");
    console.log(`   💾 Narrative saved locally.`);

    try {
      const rawModifiedFiles = await getModifiedFiles(state.repoPath);
      
      // Layer 1: Hard-coded Filter (exclude internal artifacts)
      let candidateFiles = rawModifiedFiles.filter(f => 
        !f.includes(".repatch") && 
        !f.includes(".pr-fixer-temp") &&
        !f.includes("repatch-fix-") &&
        !f.includes("state.json")
      );

      // Layer 2: LLM Cross-Verification
      if (candidateFiles.length > 0) {
        console.log(`   🔍 Cross-verifying ${candidateFiles.length} modified files...`);
        candidateFiles = await this.crossVerifyFiles(state, candidateFiles);
      }

      // Layer 3: Human-in-the-Loop Review
      const reviewResult = await this.interactiveReview(state, prTitle, narrative, candidateFiles, state.repoPath);
      prTitle = reviewResult.title;
      narrative = reviewResult.narrative;
      candidateFiles = reviewResult.files;

      if (candidateFiles.length === 0) {
        console.warn("   ⚠️ No files selected for commitment after review.");
        return { nextStep: "SUBMIT", state };
      }

      const branchName = `fix/issue-${Date.now()}`;
      console.log(`   🌿 Branching: ${branchName}`);
      await createBranch(state.repoPath, branchName);

      const testFiles = candidateFiles.filter(f => 
        f.includes("test") || f.includes("spec") || f.includes("repro")
      );
      const sourceFiles = candidateFiles.filter(f => !testFiles.includes(f));

      if (testFiles.length > 0) {
        console.log(`   💾 Committing reproduction tests...`);
        await commitChanges(state.repoPath, `test: add reproduction case for reported issue`, testFiles);
      }

      if (sourceFiles.length > 0) {
        console.log(`   💾 Committing surgical fix...`);
        await commitChanges(state.repoPath, prTitle, sourceFiles);
      } else {
        console.log("   ℹ️ No source files to commit.");
      }

      if (process.env.GH_TOKEN) {
        let headBranch = branchName;

        try {
          console.log(`   🚀 Attempting direct push...`);
          await pushBranch(state.repoPath, branchName);
        } catch (error: any) {
          const errorMessage = String(error);
          if (errorMessage.includes("403") || errorMessage.includes("denied")) {
            console.log(`   ⚠️ Direct push denied. Initiating Auto-Fork workflow...`);
            
            const fork = await forkRepository(state.repoUrl);
            const ghToken = process.env.GH_TOKEN;
            const forkUrl = `https://${ghToken}@github.com/${fork.owner}/${fork.repo}.git`;
            await setRemoteUrl(state.repoPath, "origin", forkUrl);
            
            console.log(`   🚀 Pushing to fork: ${fork.owner}/${fork.repo}...`);
            await pushBranch(state.repoPath, branchName);
            headBranch = `${fork.owner}:${branchName}`;
          } else {
            throw error;
          }
        }

        console.log(`   🔌 Submitting PR: "${prTitle}"`);
        const defaultBranch = await getDefaultBranch(state.repoPath);
        
        const pr = await createPullRequest(
          state.repoUrl,
          headBranch,
          prTitle,
          narrative,
          defaultBranch
        );
        console.log(`   🎉 Submission Complete: ${pr.html_url}`);
        state.history.push({
          step: "SUBMIT",
          action: "Submitted PR",
          result: pr.html_url,
          timestamp: Date.now()
        });
      } else {
        console.log(`   ⚠️ GH_TOKEN missing. Process halted before submission.`);
      }
    } catch (error) {
      console.error(`   ❌ Submission failed: ${error}`);
      state.errorLogs.push(`Submission failed: ${error}`);
    }

    return {
      nextStep: "SUBMIT", // Final step
      state
    };
  }

  private async interactiveReview(
    state: AgentState,
    title: string,
    narrative: string,
    files: string[],
    repoPath: string
  ): Promise<{ title: string; narrative: string; files: string[] }> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    let currentTitle = title;
    let currentNarrative = narrative;
    let currentFiles = files;

    const diffStat = await getDiffStat(repoPath);

    const provider = createProvider({ model: this.deps.model, temperature: 0 });

    while (true) {
      console.log("\n" + "=".repeat(60));
      console.log("🔍 PROPOSED PULL REQUEST REVIEW");
      console.log("=".repeat(60));
      console.log(`\n📌 TITLE: ${currentTitle}`);
      console.log(`\n📄 SUMMARY:\n${currentNarrative.slice(0, 500)}${currentNarrative.length > 500 ? "..." : ""}`);
      console.log(`\n📁 FILES TO COMMIT (${currentFiles.length}):`);
      currentFiles.forEach(f => console.log(`   - ${f}`));
      if (diffStat) {
        console.log(`\n📊 DIFF STAT:\n${diffStat}`);
      }
      console.log("\n" + "=".repeat(60));

      const answer = await rl.question(
        "\n✅ Approve this PR? (y/yes) or provide feedback to modify it: "
      );

      const normalized = answer.toLowerCase().trim();
      if (["y", "yes", "approve", "ok", "looks good"].includes(normalized)) {
        rl.close();
        return { title: currentTitle, narrative: currentNarrative, files: currentFiles };
      }

      if (["n", "no", "exit", "quit"].includes(normalized)) {
        console.log("   ⚠️ Submission cancelled by user.");
        rl.close();
        return { title: currentTitle, narrative: currentNarrative, files: [] };
      }

      // Process feedback with LLM
      console.log(`   🧠 Processing feedback...`);
      
      const systemPrompt = `You are a PR Editor assistant. The user has provided feedback on a proposed Pull Request.
Your task is to update the PR Title, Narrative, or File List based on their instructions.

### CURRENT PR DETAILS:
TITLE: ${currentTitle}
FILES: ${currentFiles.join(", ")}
NARRATIVE:
${currentNarrative}

### USER FEEDBACK:
"${answer}"

### MISSION:
Update the PR details based on the feedback. 
- If they want to change the title, change it.
- If they want to modify the summary, rewrite it accordingly.
- If they want to exclude a file, remove it from the list.
- If they want to include a file that was previously modified, but excluded, you should respect that if possible (though you only have the CURRENT list).

### RESPONSE FORMAT:
Respond with ONLY a JSON object:
{
  "title": "updated title",
  "narrative": "updated narrative",
  "files": ["file1", "file2"]
}`;

      const response = await provider.complete([{ role: "system", content: systemPrompt }]);
      try {
        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          currentTitle = parsed.title || currentTitle;
          currentNarrative = parsed.narrative || currentNarrative;
          currentFiles = parsed.files || currentFiles;
        }
      } catch (e) {
        console.warn("   ⚠️ Could not interpret feedback. Please try again.");
      }
    }
  }

  private async crossVerifyFiles(state: AgentState, files: string[]): Promise<string[]> {
    const provider = createProvider({ model: this.deps.model, temperature: 0 });
    
    const systemPrompt = `You are a Senior Engineer performing a final review of modified files before committing them to a repository.

### CONTEXT:
ISSUE: ${state.issueText}
PLAN: ${state.history.find(h => h.step === "PLAN")?.result || "No explicit plan"}

### CANDIDATE FILES:
${files.map(f => `- ${f}`).join("\n")}

### MISSION:
Analyze the CANDIDATE FILES against the ISSUE and PLAN. 
1. Determine which files are GENUINELY required for the bug fix or the reproduction test.
2. EXCLUDE any files that seem like internal agent state, temporary logs, or artifacts (e.g., .repatch, .json files that weren't part of the source, etc.).
3. Be AGGRESSIVE in dropping files that were not explicitly mentioned in the PLAN or necessary for the reproduction.

### RESPONSE FORMAT:
Respond with ONLY a JSON array of strings containing the paths of the files to KEEP.
Example: ["src/index.ts", "tests/repro.js"]`;

    const response = await provider.complete([{ role: "system", content: systemPrompt }]);
    
    try {
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const verifiedFiles = JSON.parse(jsonMatch[0]) as string[];
        // Ensure we only return files that were in the original candidate list
        return verifiedFiles.filter(f => files.includes(f));
      }
    } catch (error) {
      console.warn(`   ⚠️ Could not parse LLM verification response. Falling back to hard-coded filters.`);
    }

    return files;
  }

  private findPRTemplate(repoPath: string): string | null {
    const locations = [
      ".github/PULL_REQUEST_TEMPLATE.md",
      "PULL_REQUEST_TEMPLATE.md",
      "docs/PULL_REQUEST_TEMPLATE.md",
      ".github/pull_request_template.md",
    ];

    for (const loc of locations) {
      const fullPath = path.join(repoPath, loc);
      if (fs.existsSync(fullPath)) {
        return fs.readFileSync(fullPath, "utf-8");
      }
    }
    return null;
  }

  private async populateTemplate(state: AgentState, template: string, diff: string): Promise<string> {
    const provider = createProvider({ model: this.deps.model });
    const baseNarrative = await this.generateNarrative(state, diff);

    const systemPrompt = `You are a Senior Contributor mapping a bug fix to a repository's Pull Request template.

PR TEMPLATE:
${template}

OUR TECHNICAL NARRATIVE:
${baseNarrative}

### MISSION:
Rewrite the OUR TECHNICAL NARRATIVE into the PR TEMPLATE format. 
1. Keep the tone professional and engineering-focused.
2. Ensure ALL raw verification logs from the narrative are preserved in the appropriate template sections.
3. Check all relevant checkboxes if they are mentioned in the narrative.

Respond with ONLY the populated template markdown.`;

    const response = await provider.complete([{ role: "system", content: systemPrompt }]);
    return response.content;
  }

  private async generateNarrative(state: AgentState, diff: string): Promise<string> {
    const provider = createProvider({ model: this.deps.model });
    const understandEntry = state.history.find(h => h.step === "UNDERSTAND");
    const planEntry = state.history.find(h => h.step === "PLAN");

    const systemPrompt = `You are a Senior Engineer writing a Pull Request description.
Your goal is to provide a FACTUAL and CONCISE summary of the changes made, based ONLY on the actual git diff.

### INPUT DATA:
1. ORIGINAL ISSUE: ${state.issueText}
2. ORIGINAL PLAN: ${planEntry?.result || "No explicit plan"}
3. ACTUAL GIT DIFF:
\`\`\`diff
${diff.slice(0, 5000)}
\`\`\`

### MISSION:
Write a PR description with the following sections:
- ## Description: Factual summary of what was actually changed in the code.
- ## Technical Justification: Why these specific changes fix the issue.
- ## Comparison to Plan: Briefly note if the implementation diverged from the original plan (e.g., "Simplified the approach to only fix the critical import error").

### RULES:
- DO NOT hallucinate features that are not in the diff.
- If the diff is smaller than the plan, accurately describe ONLY what is in the diff.
- Keep it professional and technical.
- Respond ONLY with the markdown for these sections.`;

    const response = await provider.complete([{ role: "system", content: systemPrompt }]);
    const summary = response.content;

    const bugProof = state.reproductionFailureOutput 
      ? `\n#### Reproduction\nThe following test case was executed in an isolated container and failed as expected:\n\`\`\`text\n${state.reproductionFailureOutput}\n\`\`\`\n`
      : "";

    const fixProof = state.verificationSuccessOutput
      ? `\n#### Verification\nAfter applying the fix, the reproduction test and existing project suite were executed successfully:\n\`\`\`text\n${state.verificationSuccessOutput}\n\`\`\`\n`
      : "";

    const referenceSection = state.references && state.references.length > 0
      ? `\n## References\n${state.references.map(url => `- ${url}`).join("\n")}\n`
      : "";

    return `${summary}

## Verification Proof
${bugProof}${fixProof}
${referenceSection}
## Checklist
- [x] I have added a reproduction test case.
- [x] All existing tests pass.
- [x] My changes adhere to the project's coding standards.

Fixes: ${state.issueUrl || "the reported issue"}`;
  }
}
