# Autonomous PR-Fixer: System Architecture

## 1. Component Map
The system uses a **Modular Orchestration** pattern to separate the "Thinking" from the "Environment."

*   **Entry Adapters:** CLI and GitHub Webhook handlers that normalize inputs into a `FixRequest`.
*   **Orchestrator:** A LangGraph-powered state machine that drives the 7-step Inviolable Loop.
*   **Sandbox Manager:** Uses **Nixpacks** to detect ecosystems and **Docker** to provide isolated execution.
*   **Context Engine:** Manages LLM memory and prunes codebase context for small-window models (Ollama).
*   **Inference Bridge:** Powered by **LiteLLM** for model-agnosticism and **Zod/Pydantic** for tool-call validation.

## 2. Core Loop Engine (The 7-Step State Machine)
The loop is implemented as a directed graph with the following nodes:
1.  **UNDERSTAND:** Analyzes the issue and project structure.
2.  **EXPLORE:** Searches the codebase for relevant modules.
3.  **REPRODUCE:** Creates a `repro.test` file. **Execution gate: Must fail.**
4.  **PLAN:** Drafts the fix strategy.
5.  **EXECUTE:** Applies targeted edits using `edit_file`.
6.  **VERIFY:** Runs tests. If they fail, the loop transitions back to **PLAN**.
7.  **SUBMIT:** Generates the PR and engineering narrative.

## 3. Environment Orchestration
*   **Language Detection:** `nixpacks plan` identifies the runtime (Node, Python, Go, etc.).
*   **Isolation:** Every `run_command` tool call is executed inside a Docker container with restricted networking and CPU/Memory limits.
*   **Cache Management:** Persistent volumes map the host's dependency caches (e.g., `~/.npm`) to the container to speed up "Cold Starts."

## 4. Model Agnosticity & Tool Guarding
*   **LiteLLM:** Acts as a universal adapter. Switching from `claude-3-5-sonnet` to `ollama/qwen2.5-coder` requires only an environment variable change.
*   **Schema Guard:** Every tool call from the LLM is validated against a JSON schema before execution. Hallucinated arguments trigger a "Correction Prompt" back to the model.
*   **Semantic Pruning:** For 32k context models, the system uses function-level chunking and summarizes "Visited Files" to maximize context utility.

## 5. Tool Library & Safety
*   **Tool Interface:** Each tool (e.g., `grep_search`, `read_file`) is a standalone class with a strictly defined input schema.
*   **Dangerous Commands:** `run_command` uses a whitelist of safe binaries. Commands like `rm -rf /` or `curl` are intercepted and blocked.

## 6. PR Output Engine
*   **Artifact Collection:** The system preserves the failure logs from the `REPRODUCE` phase and success logs from the `VERIFY` phase.
*   **Narrative Generation:** An LLM call synthesizes the history into a PR body explaining the "Why" and "How" of the fix.
*   **Git Strategy:** Creates a feature branch, commits with Conventional Commits, and pushes via the GitHub API.

## 7. V1 Architecture Critique
*   **Over-engineered:** Deep Jira/Linear/Sentry integrations and a full Benchmark Suite should be deferred to V2. V1 must prioritize the CLI-to-Docker reliability.
*   **Fragile:** Automatic error recovery for Nixpacks builds is experimental and may require human-in-the-loop checkpoints in V1.
*   **SPoF:** The Sandbox Manager is the most complex component; any failure in Docker connectivity or Nixpacks detection will stall the entire agent.

## 8. Refined V1 Folder Structure
```text
pr-fixer/
├── src/
│   ├── orchestrator/      # State machine logic
│   ├── sandbox/           # Nixpacks & Docker management
│   ├── context/           # Memory & Pruning
│   ├── tools/             # Filesystem & Shell tools
│   ├── adapters/          # CLI & Git providers
│   ├── inference/         # LiteLLM & Schema validation
├── tests/                 # Unit & Integration tests
├── docs/                  # PRD, Architecture, and Truth
```