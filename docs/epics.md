# Autonomous PR-Fixer: Execution Plan

## 1. Epics (Incremental Value Delivery)

### Epic 1: The Environment Foundation (V0.1)
**Goal:** Establish the "Outer Loop." A CLI that can clone a repository and build a sandboxed, language-detected Docker environment via Nixpacks.
*   **Value:** Users can verify the tool can "see" and "build" their project safely.

### Epic 2: The Brain & Tool Library (V0.2)
**Goal:** Integrate LiteLLM and build the basic toolset (list, read, grep). 
*   **Value:** The agent can now "explore" the codebase and answer questions about it, even if it can't fix bugs yet.

### Epic 3: The Inviolable Loop (V0.3)
**Goal:** Implement the LangGraph-powered state machine (Steps 1-6: Understand to Verify).
*   **Value:** The agent can now autonomously find, reproduce, and fix bugs in a local repository.

### Epic 4: The PR Narrative & Handoff (V1.0)
**Goal:** Implement Step 7 (Submit). Generate the "Engineering Narrative" and push to GitHub.
*   **Value:** Complete end-to-end autonomous bug fixing with high-trust PR output.

### Epic 5: Ecosystem Expansion (V1.1+)
**Goal:** Add external adapters (Jira, Slack, Sentry) and the Benchmark Suite.
*   **Value:** Scaling the tool into existing team workflows.

---

## 2. Epic 1: Detailed User Stories

### Story 1: Repo Cloning & Auth
*   **As a** developer, **I can** provide a GitHub URL to the CLI, **so that** the tool can fetch the source code locally for processing.
*   **Acceptance Criteria:**
    *   Supports HTTPS and SSH URLs.
    *   Uses `GH_TOKEN` from environment if provided.
    *   Handles "Repository not found" or "Access denied" gracefully.
*   **Implementation:** `src/adapters/git.ts`. Use `simple-git` or `isomorphic-git`.

### Story 2: Zero-Config Detection
*   **As a** developer, **I can** trigger a "dry run" build, **so that** I can see which language and tools Nixpacks detects in my repo.
*   **Acceptance Criteria:**
    *   `nixpacks plan` runs successfully on Node, Python, and Go projects.
    *   Outputs a JSON summary of the detected environment.
*   **Implementation:** `src/sandbox/nixpacks.ts`. Wrapper around `execa`.

### Story 3: Sandboxed Execution
*   **As a** security-conscious developer, **I can** run a command inside the Nixpacks-built container, **so that** my host machine remains untouched.
*   **Acceptance Criteria:**
    *   `docker build` succeeds using the Nixpacks-generated Dockerfile.
    *   Commands run inside the container (e.g., `ls`, `npm --version`) return expected output.
*   **Implementation:** `src/sandbox/docker.ts` and `src/tools/shell.ts`.

---

## 3. Skeleton Scaffolding

### File Tree
```text
pr-fixer/
├── src/
│   ├── index.ts              # CLI Entry point (Commander.js)
│   ├── orchestrator/
│   │   ├── machine.ts        # LangGraph State Machine definition
│   │   ├── state.ts          # Type definitions for AgentState
│   ├── sandbox/
│   │   ├── nixpacks.ts       # Nixpacks CLI wrapper (plan/build)
│   │   ├── docker.ts         # Docker API wrapper (containers/volumes)
│   │   ├── manager.ts        # Orchestrates Nixpacks -> Docker flow
│   ├── context/
│   │   ├── engine.ts         # Logic for reading files and pruning context
│   │   ├── memory.ts         # In-memory store for visited files/symbols
│   ├── tools/
│   │   ├── filesystem.ts     # tools: list_files, read_file, grep_search
│   │   ├── shell.ts          # tool: run_command (executes in Docker)
│   │   ├── registry.ts       # Tool registration and schema exports
│   ├── adapters/
│   │   ├── git.ts            # Git operations (clone, branch, push)
│   │   ├── github.ts         # GitHub API (PR creation, issue fetching)
│   │   ├── reporter.ts       # Activity stream (Terminal/Event bus)
│   ├── inference/
│   │   ├── provider.ts       # LiteLLM wrapper
│   │   ├── guard.ts          # Zod-based tool call validation
├── tests/
│   ├── integration/
│   │   ├── sandbox.test.ts   # Epic 1 verification
├── docs/                     # Documentation
├── package.json
└── tsconfig.json
```

### Epic 1: Key Function Stubs
```typescript
// src/sandbox/nixpacks.ts
export async function getBuildPlan(repoPath: string): Promise<NixpacksPlan>;
export async function generateDockerfile(repoPath: string): Promise<string>;

// src/sandbox/docker.ts
export async function buildImage(dockerfile: string, tag: string): Promise<void>;
export async function runInContainer(tag: string, cmd: string): Promise<CommandResult>;

// src/adapters/git.ts
export async function cloneRepo(url: string, targetDir: string): Promise<void>;
```

---

## 4. Dependencies & Sequence (Epic 1)

1.  **Infrastructure (Day 1):** Setup `package.json`, TypeScript, and the CLI entry point (`index.ts`).
2.  **Git Adapter (Day 1):** Implement `cloneRepo`. 
    *   *Smoke Test:* `pr-fixer fix <url>` creates a local folder with the code.
3.  **Nixpacks Wrapper (Day 2):** Implement `getBuildPlan`.
    *   *Smoke Test:* CLI prints "Detected: Node.js" for a JS repo.
4.  **Docker Orchestration (Day 3):** Implement `buildImage` and `runInContainer`.
    *   *Smoke Test:* `pr-fixer verify <url>` builds a container and runs `ls`.

---

## 5. Critique & De-risk

### Riskiest Assumption
**"Nixpacks is fast and reliable enough for an interactive CLI."**
If Nixpacks takes 5 minutes to detect an environment, the user will abandon the tool.

### Validation Spike (The "Nix-Check")
Before building Epic 1, perform a 2-hour spike:
1.  Manually run `nixpacks plan` on 3 varied repos (Python, Node, Go).
2.  Measure the time and accuracy of detection.
3.  Verify that `nixpacks build` can run without `sudo` in the target environment.
4.  Check if `LiteLLM` can successfully call an OpenAI-compatible endpoint with a simple "Hello World" tool-call prompt.

---
**Next Step:** Perform the "Nix-Check" spike to validate detection accuracy before committing to the `sandbox/` implementation.