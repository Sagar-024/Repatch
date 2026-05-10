# Repatch: Autonomous Test-Driven Debugging Agent

Repatch is an autonomous bug-fixing agent designed to automate the full lifecycle of software debugging. Unlike conventional LLM-based coding assistants that prioritize raw generation, Repatch is built on a foundational principle of **verifiable correctness**. It utilizes a strict state machine to reproduce, isolate, and verify bugs within isolated environments before proposing any modifications to production code.

This project is an exploration into building high-trust autonomous systems that integrate seamlessly into the modern software development lifecycle (SDLC).

## Engineering Principles

### The Inviolable Loop (TDD Enforcement)
Repatch enforces a rigid operational sequence inspired by Test-Driven Development (TDD):
1.  **Understand**: Structural analysis of the issue report and environment.
2.  **Explore**: Codebase mapping via restricted filesystem tools to isolate the culprit.
3.  **Reproduce (Mandatory)**: Generation of a dedicated reproduction test. The agent is strictly prohibited from modifying source code until a failing test demonstrates the bug.
4.  **Plan**: Design of a minimal, surgical patch targeting only the isolated fault.
5.  **Execute**: Application of the patch using precise filesystem operations.
6.  **Verify**: Multi-stage verification including the reproduction test, the full project test suite, and automated linter/formatter checks.
7.  **Submit**: Generation of an "Engineering Narrative" and automated Pull Request creation.

### Environment Abstraction
Repatch achieves language agnosticity through environment introspection. It utilizes **Nixpacks** to analyze repository signatures and generate optimized OCI-compliant containers. This ensures that every fix is executed in a clean, reproducible, and sandboxed environment that matches the project's specific runtime requirements (Node.js, Python, Go, Rust, etc.).

### Trust via Transparency
Every Pull Request opened by Repatch is a comprehensive proof package. It includes:
*   **Root Cause Analysis**: A technical breakdown of the isolated fault.
*   **Raw Reproduction Logs**: Verifiable output of the failing test.
*   **Raw Verification Logs**: Verifiable output of the passing suite post-fix.
*   **Style Compliance**: Proof of passing linter/formatter checks.

## Technical Architecture

*   **Orchestration**: A robust state machine managing transitions and backtracking logic.
*   **Sandbox Manager**: Handles ephemeral Docker lifecycles and Nixpacks build-planning.
*   **Inference Layer**: A provider-agnostic wrapper supporting OpenAI, Anthropic, and Gemini.
*   **Tool Registry**: A library of surgical filesystem and shell tools with strict schema validation.
*   **Adapters**: Decoupled interfaces for Git operations and GitHub API integration.

## Usage

### Prerequisites
*   Docker Desktop (Active daemon)
*   Node.js 20+
*   GH_TOKEN (for PR submission)

### Execution
```bash
npm run dev -- autofix <repo_url_or_path> -i "Issue description" --hint "Optional guidance"
```

## Career Objective
I am a software engineer focused on building robust, automated systems at the intersection of infrastructure and AI. This project serves as a demonstration of my ability to design complex, multi-layered architectures that prioritize security, reliability, and developer experience. I am currently seeking opportunities to apply these skills within high-growth engineering teams.

## License
MIT
