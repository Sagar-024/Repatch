# Autonomous PR-Fixer — The Truth

> “Junior Developer in a box.”  
> An AI agent that autonomously diagnoses, reproduces, and fixes bugs from a GitHub issue — then opens a pull request so rigorous it earns a human maintainer’s instant trust. **Language-agnostic. Architecture-first.**

## The Mission

Turn a bug report into a **merge-ready PR** — using only a repository URL, an issue description, and a sandboxed Docker environment.  
The agent detects any language ecosystem and adapts its toolchain on the fly.  
It thinks like a senior engineer: reproduce, prove, fix, verify — never guess.

## Why Architecture Matters (Our Secret)

Most AI coding tools are just prompts with file read/write. **The model alone isn't the magic — the surrounding architecture is.**  
This project takes inspiration from the best systems (like Claude Code) that make the same model perform 10× better by:

- Giving the model a **narrow, well-designed tool set** (no overload, no ambiguity).
- Enforcing a **hard sequential loop** (Understand → Reproduce → Fix → Verify → Submit) that prevents skipping steps.
- Providing **structured context management** (the agent knows what it tried, what failed, and why).
- Running everything inside **ephemeral, reproducible Docker containers** — so the agent’s actions are auditable, safe, and repeatable.

A brilliant architecture makes the same LLM feel like a genius. That’s what we’re building.

## The Hybrid Wedge (Strategic Trust)

Repatch solves the AI trust gap by splitting its power into two modes:
1.  **Reproduction-as-a-Service (`reproduce`):** A read-only command that produces a "Golden Artifact"—a verified, failing test case in a sandbox. This gives maintainers immediate value with zero risk.
2.  **Autonomous Fix (`fix`):** Building on the reproduction, this mode applies a patch and raises a PR, but only after an **Interactive Review Gate** where the maintainer approves the diff.

By leading with reproduction, we build the "Whoa" moment that earns the right to fix the code.

## The Inviolable Loop (Every Fix, No Exceptions)


1. **Understand** — Parse the issue. What’s expected, what’s broken?
2. **Explore** — Navigate the codebase (list files, grep, read) until the culprit module is found.
3. **Reproduce (MANDATORY)** — Write a **dedicated reproduction test**. The test must **fail** and demonstrate the exact bug. No reproduction, no permission to touch production code.
4. **Plan** — Draft a minimal, safe edit that fixes the bug and nothing else.
5. **Execute** — Apply the edit using precise, patch‑style tool calls (no full-file rewrites).
6. **Verify** — Run the reproduction test (now passes) + the full test suite (no regressions). If the repo has linters/format checks, run them too.
7. **Submit** — Create a branch, commit with a clear message, push, and open a PR. The PR description narrates the whole `Reproduce → Fix → Verify` journey with test outputs and rationale.

## Foundational Principle: Test‑Driven Debugging as Proof of Work

**No production code shall be modified without a new, dedicated test that first proves the bug exists.**  
This is not just a workflow; it is the agent’s quality seal.

Every PR it opens is a self-contained **proof package**:

- **Proof of Bug:** `test_reproduction_issue_<id>.{ext}` that fails on the original code.
- **Resolution:** The minimal, safe patch (diff‑style).
- **Proof of Fix:** Output of the test command showing all tests green.
- **Engineering Narrative:** A PR body that links each step to its commit, explaining _why_ the fix is correct.

This is what earns trust from human maintainers — even when the fixer is a machine.

## Target User (V1)

You, the developer. Use it to squash bugs in your own projects (any language) and build an automated contribution track record.  
Eventually, point it at public repositories and watch it become your silent, high-quality contributor.

## Long‑Term Vision

- Work on **any repository** with a recognizable build/test setup: Python, JavaScript/TypeScript, Rust, Go, Java, Ruby, C/C++, and beyond.
- Read `CONTRIBUTING.md`, infer code style, and execute the project’s own test commands and linters — no hardcoded per‑language logic.
- Produce PRs maintainers **want** to merge — clean, well‑explained, and compliant with every project convention.
- Eventually respond to reviewer feedback and iterate (agent‑in‑the‑loop).
- This project will stand as a portfolio centerpiece: proof that you understand SDLC automation, safe LLM tool design, and product‑minded engineering at a deep systems level.

## Technical Architecture (V1)

### Environment

- **Sandbox:** Ephemeral Docker containers. No host filesystem access beyond the repo clone.
- **Language Detection:** The agent inspects repo signals (`package.json`, `Cargo.toml`, `go.mod`, `requirements.txt`, etc.) and selects a base image + runtime. A small, extendable knowledge base maps ecosystems to images/commands.
- **Reproducibility:** Every step is recorded and could be replayed.

### The Brain

- An LLM with **function calling** (tool use). Not a chat loop. The model decides which tool to use and with what parameters.
- Context is carefully trimmed: the agent retains a memory of file reads, search results, test outputs, and prior actions to avoid redundant work.

### The Tool Library (Small, Safe, Universal)

- `list_files(path)` — recursive listing
- `read_file(path)` — returns content with line numbers
- `grep_search(pattern)` — fast multi‑file text search
- `edit_file(path, old_snippet, new_snippet)` — safe, targeted patch
- `run_command(cmd, timeout, env)` — restricted allowlist, used for test/lint/build commands
- `prepare_language_env(repo_path)` — auto‑detects and sets up the correct docker container

### TDD Gate

- A `repro_test` tool or convention: the agent always writes a test file before editing any production code. The system enforces this — no test, no edit.

## Non‑Goals (V1)

- No UI — CLI or single invocation script.
- No auto‑merging — a human reviews before marking ready.
- No massive refactors or design‑level changes.
- No interactive conversation with maintainers.
- No multi‑repo batching or async job queues.
