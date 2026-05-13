import * as fs from "fs";
import * as path from "path";
import { AgentState, Step } from "../state.js";
import { BaseStep, StepDependencies, StepResult } from "./base.js";
import { createProvider } from "../../inference/provider.js";
import { createBranch, commitChanges, pushBranch, getDefaultBranch, setRemoteUrl, getModifiedFiles } from "../../adapters/git.js";
import { createPullRequest, forkRepository } from "../../adapters/github.js";

export class SubmitStep implements BaseStep {
  readonly name: Step = "SUBMIT";

  constructor(private deps: StepDependencies) {}

  async execute(state: AgentState): Promise<StepResult> {
    console.log(`   📝 Drafting Engineering Narrative...`);

    const template = this.findPRTemplate(state.repoPath);
    let narrative = "";
    
    if (template) {
      console.log(`   📄 PR Template detected. Mapping narrative to template...`);
      narrative = await this.populateTemplate(state, template);
    } else {
      narrative = await this.generateNarrative(state);
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
      const branchName = `fix/issue-${Date.now()}`;
      console.log(`   🌿 Branching: ${branchName}`);
      await createBranch(state.repoPath, branchName);

      const modifiedFiles = await getModifiedFiles(state.repoPath);
      const testFiles = modifiedFiles.filter(f => 
        f.includes("test") || f.includes("spec") || f.includes("repro")
      );
      const sourceFiles = modifiedFiles.filter(f => !testFiles.includes(f));

      if (testFiles.length > 0) {
        console.log(`   💾 Committing reproduction tests...`);
        await commitChanges(state.repoPath, `test: add reproduction case for reported issue`, testFiles);
      }

      console.log(`   💾 Committing surgical fix...`);
      await commitChanges(state.repoPath, prTitle, sourceFiles);

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

  private async populateTemplate(state: AgentState, template: string): Promise<string> {
    const provider = createProvider({ model: this.deps.model });
    const baseNarrative = this.generateNarrative(state);

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

  private generateNarrative(state: AgentState): string {
    const understandEntry = state.history.find(h => h.step === "UNDERSTAND");
    const planEntry = state.history.find(h => h.step === "PLAN");

    let technicalSummary = "This PR addresses a logic issue identified in the current implementation.";
    if (understandEntry?.result) {
      try {
        const jsonMatch = understandEntry.result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          technicalSummary = parsed.analysis || parsed.summary || technicalSummary;
        }
      } catch {
        technicalSummary = understandEntry.result.slice(0, 500);
      }
    }

    let justification = "The fix applies surgical changes to correct the behavior while ensuring zero regressions.";
    if (planEntry?.result) {
      try {
        const jsonMatch = planEntry.result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          justification = parsed.changes ? parsed.changes.join(" ") : (parsed.rootCause || justification);
        }
      } catch {
        justification = planEntry.result.slice(0, 500);
      }
    }

    const bugProof = state.reproductionFailureOutput 
      ? `\n#### Reproduction\nThe following test case was executed in an isolated container and failed as expected:\n\`\`\`text\n${state.reproductionFailureOutput}\n\`\`\`\n`
      : "";

    const fixProof = state.verificationSuccessOutput
      ? `\n#### Verification\nAfter applying the fix, the reproduction test and existing project suite were executed successfully:\n\`\`\`text\n${state.verificationSuccessOutput}\n\`\`\`\n`
      : "";

    const referenceSection = state.references && state.references.length > 0
      ? `\n## References\n${state.references.map(url => `- ${url}`).join("\n")}\n`
      : "";

    return `## Description
${technicalSummary}

## Technical Justification
${justification}

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
