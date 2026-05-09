# Autonomous PR-Fixer: Product Requirements Document (PRD)

## 1. Executive Summary
**Vision:** "Junior Developer in a box."
An AI agent that autonomously diagnoses, reproduces, and fixes bugs from a GitHub issue, opening a PR so rigorous it earns instant trust. It is language-agnostic, architecture-first, and builds trust through an inviolable Test-Driven Debugging (TDD) loop.

## 2. Trigger & Input (Dual-Entry Strategy)
To support both fast individual workflows and scalable team integrations.

*   **The Power CLI (Inner Loop):** 
    *   Command: `pr-fixer fix <repo_url|local_path> <issue_url|id|text>`
    *   Allows humans to steer the agent via hints: `--hint "check the login controller"`
*   **The GitHub App/Webhook (Team Automation):** 
    *   Trigger: Commenting `/fix` on an issue or PR.
*   **Authentication:** Zero-friction credential management using standard environment variables (`GH_TOKEN`) and SSH keys, with automated log masking.

## 3. User Flow & Experience (The Activity Stream)
The system builds trust not by hiding its work, but by showing its "thought process" clearly.

*   **Phase 1: Analysis:** The agent outputs a concise summary of the issue and its intended reproduction strategy.
*   **Phase 2: The Thought Stream:** A streaming, collapsible log of tool usage (e.g., `🔍 Searching codebase...`, `🧪 Creating reproduction test...`).
*   **The Reproduction Milestone (MANDATORY):** The agent MUST explicitly output a failure state proving it reproduced the bug: `"❌ Reproduction failed as expected. Moving to fix."`
*   **Phase 3: The Fix & Verify:** Applies a minimal patch, runs the test suite, and outputs `"✅ Tests passed!"`
*   **Phase 4: Handoff:** Generates a rich terminal summary containing the PR Title, Branch Name, and a direct PR URL.

## 4. Environment Setup (Scale to 1M+ Users)
The "Holy Grail" of environment setup is zero-config, reproducible, and portable. We will utilize a "Nix as the Engine, Containers as the Shell" architecture.

*   **Zero-Config Build (Nixpacks):** Instead of fragile heuristic scripts, the agent uses **Nixpacks** to inspect the repository (`package.json`, `Cargo.toml`, etc.) and automatically generate an optimized OCI container image containing the exact language runtimes needed.
*   **Dependency Management (Devbox/Nix Flakes):** Handles complex monorepos by supporting scoped environments that switch automatically on directory change.
*   **Cold Start & Caching:** Dependencies are aggressively cached in Docker volumes (e.g., `~/.npm`, `~/.cargo`) to make subsequent fixes near-instantaneous.
*   **Failure Recovery:** If an environment fails to build (e.g., missing system library), the agent parses the build error, attempts to inject the missing Nix package, and retries automatically before asking the user.

## 5. The AI Brain: Model Agnosticity & Ollama
To ensure accessibility for both local-first developers and enterprise teams, the agent is "LLM-Agnostic."

*   **Universal Bridge (LiteLLM):** Supports 100+ providers (OpenAI, Anthropic, Gemini, Ollama, vLLM) via a standardized interface. Users can switch models via `AI_MODEL` environment variable.
*   **Local-First Optimization (Ollama):** 
    *   Optimized for **Qwen2.5-Coder** and **Llama 3.1** for zero-cost, private execution.
    *   **Context Management:** Automatic pruning and semantic compression of file contents to fit within local model context windows (32k-64k).
    *   **Deterministic Validation:** Every AI-generated tool call is validated against a strict schema (e.g., Zod/Pydantic) to prevent hallucinations from affecting the host system.
*   **Portable Skills:** Agent logic and coding conventions are stored in plain-text `SKILL.md` files, ensuring consistent behavior across different models.

## 6. The Inviolable Execution Loop
1.  **Understand:** Parse issue and environment.
2.  **Explore:** Map codebase via restricted search tools.
3.  **Reproduce:** Write a failing test. **No test = No code edit.**
4.  **Plan:** Draft a minimal diff.
5.  **Execute:** Apply the patch safely.
6.  **Verify:** Run the exact test (must pass) and full suite (no regressions).
7.  **Submit:** Commit, push, and open the PR.

## 7. PR Creation & Output
The PR body acts as the agent's "Engineering Narrative" and proof of work.
*   **Title:** `Fix: <Concise description of the change>`
*   **Body Template:**
    *   **Root Cause Analysis:** What was broken and why.
    *   **Proof of Bug:** Output of the initial failing test.
    *   **The Fix:** Rationale behind the specific patch.
    *   **Proof of Fix:** Output of the passing test suite.

## 8. Security, Sandboxing & Boundaries
*   **Sandboxing:** All code execution happens strictly inside the ephemeral Docker/Nixpacks container. The host filesystem is completely isolated.
*   **Disallowed Commands:** Network access during test execution is blocked unless explicitly mocked or whitelisted. Destructive OS commands (`rm -rf /`) are blocked at the container boundary.

## 9. Ecosystem & Integrations
To act as a universal plug-in for modern engineering workflows, the agent supports:

*   **Issue Trackers:** Native integration with **Jira** and **Linear** via webhooks. Labeling a ticket `ai-fix` triggers the autonomous loop.
*   **Error Monitoring:** Integration with **Sentry** and **LogRocket** to automatically attempt fixes for production crashes based on stack traces.
*   **Chat Ops:** First-class **Slack** and **Discord** bots for triggering fixes and receiving "Activity Stream" updates in real-time.
*   **IDE Support:** A VS Code extension that provides a "Fix with Agent" GUI, utilizing the local/remote Nix sandbox.
*   **Agent-to-Agent:** Supports **Model Context Protocol (MCP)**, allowing other AI assistants to delegate complex TDD tasks to the PR-Fixer.

## 10. Data Sovereignty & Privacy
Building trust requires absolute transparency regarding data handling.

*   **Local-First Execution:** When using the CLI + Ollama, **zero data** leaves the user's machine. The code, the issue text, and the model weights all stay local.
*   **Zero-Training Guarantee:** For cloud-based models (OpenAI/Anthropic), the agent uses "API-only" modes which contractually prohibit the use of customer data for model training.
*   **Audit Logs:** Every command run inside the Docker container is logged and auditable, ensuring the agent's actions are transparent and non-destructive.

## 11. Meta-Testing (Testing the Agent)
We will maintain a "Benchmark Suite" of historic open-source GitHub issues with known PR fixes. CI will trigger the agent against these issues, asserting that the agent can:
1. Autonomously build the environment.
2. Generate a failing test.
3. Apply a fix that passes the tests.
4. Keep the patch diff within an acceptable similarity margin to the human-authored fix.