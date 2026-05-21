# Repatch

An autonomous bug-fixing agent that takes a GitHub issue, reproduces the bug, plans a fix, applies it, verifies it works, and opens a PR — all without human intervention.

Built as a learning project to explore agent architecture, LLM tool-calling, and sandboxed execution. Active development — contributions and feedback welcome.

---

## What It Does

Give it a repo URL and an issue description. It will:

1. **Understand** — Parse the issue and build context about the codebase
2. **Explore** — Use LLM-guided tool calls to find relevant files
3. **Reproduce** — Generate a failing test that proves the bug exists
4. **Plan** — Design a surgical fix based on the reproduction
5. **Execute** — Apply the fix using fuzzy code matching
6. **Verify** — Run tests + linters in a sandbox to confirm the fix works
7. **Submit** — Open a PR with the fix and an engineering narrative

If any step fails, it backtracks (e.g., VERIFY → PLAN if tests still fail) and tries again.

---

## Architecture

```
Orchestrator (State Machine)
  ├── Steps: UNDERSTAND → EXPLORE → REPRODUCE → PLAN → EXECUTE → VERIFY → SUBMIT
  ├── Middleware: Persistence (checkpoint saves)
  └── Tool Library: list_files, read_file, grep_search, edit_file, write_file, run_command, create_reproduction_test

Inference Layer
  ├── OpenAI (GPT-4o, DeepSeek)
  ├── Anthropic (Claude 3.5 Sonnet)
  ├── Google Gemini (native API + CLI fallback)
  └── Mimo (Gitlawb OpenGateway)

Sandbox Layer
  ├── Nixpacks (language detection)
  ├── Docker (isolated execution)
  └── Local fallback (when Docker unavailable)
```

Key design decisions:
- **Strategy Pattern** for steps — each step is a self-contained class with its own LLM prompt and tool subset
- **Map of Truth** — file tree generated upfront to ground the LLM and prevent path hallucinations
- **Fuzzy Surgical Matching** — if the LLM's edit snippet doesn't exactly match, a normalized sliding window search tries to find the intended location
- **Path Traversal Protection** — write operations are validated to stay within the repo directory

---

## Supported Languages (Sandbox Detection)

Auto-detected via Nixpacks or fallback heuristics:

| Language | Detection File |
|----------|---------------|
| Node.js  | package.json  |
| Python   | requirements.txt, pyproject.toml, setup.py |
| Go       | go.mod        |
| Rust     | Cargo.toml    |
| Java     | pom.xml, build.gradle |
| Ruby     | Gemfile       |
| PHP      | composer.json |

---

## Installation

### Prerequisites
- Node.js 20+
- Docker Desktop (optional — local fallback available)
- Git

### Install
```bash
git clone https://github.com/Sagar-024/Repatch.git
cd Repatch
npm install
npm run build
npm install -g .
```

---

## Configuration

### Interactive Setup
```bash
repatch configure
```

### Manual — `.repatch.yaml`
```yaml
model: "gpt-4o"  # Options: gpt-4o, claude-3-5-sonnet-latest, gemini-1.5-pro, mimo-v2.5-pro
openai:
  apiKey: "sk-..."
  baseUrl: "https://api.openai.com/v1"
anthropic:
  apiKey: "sk-ant-..."
gemini:
  apiKey: "AIzaSy..."
mimo:
  apiKey: "ogw_..."
  baseUrl: "https://opengateway.gitlawb.com/v1"
github:
  token: "ghp_..."
sandbox:
  memory: "4g"
  cpus: 2
  network: false
```

### Environment Variables
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MIMO_API_KEY`, `GH_TOKEN`, `AI_MODEL`

---

## Usage

### Check Environment
```bash
repatch check
```

### Reproduce a Bug (Read-Only)
```bash
repatch reproduce <repo-url> -i "Issue description"
```

### Fix a Bug (Full Loop)
```bash
# From a description
repatch fix <repo-url> -i "The login form returns 500 on empty email"

# From a GitHub issue
repatch fix <repo-url> -i "https://github.com/owner/repo/issues/42"

# With a hint
repatch fix <repo-url> -i "Issue description" -h "Check the auth middleware"

# Local execution (skip Docker)
repatch fix <repo-url> -i "Issue description" --local
```

### Analyze/Fix a Pull Request
```bash
repatch pr <pr-url>           # Analysis only
repatch pr <pr-url> --fix     # Analyze and fix
```

### Explore a Codebase
```bash
repatch explore .                          # Summary of the project
repatch explore . -q "How does auth work?" # Specific question
repatch explore . -i                       # Interactive REPL
```

---

## Testing

```bash
npm test                    # Run all tests
npm run test:watch          # Watch mode
npm run test:coverage       # With coverage report
```

---

## Known Limitations

- **No cost tracking** — LLM calls have no token budget or spend monitoring
- **Checkpoint resume not implemented** — persistence saves state but doesn't support resuming a crashed run
- **Gemini CLI tool parsing** — uses multi-strategy parsing (code blocks → full JSON → regex) but may still struggle with deeply nested tool arguments
- **Sandbox is per-run** — no shared container pool or caching between runs
- **Language detection** — fallback heuristics cover 8 languages but Nixpacks (when installed) handles more

---

## Project Status

Active development. The core loop (understand → explore → reproduce → plan → execute → verify → submit) works. The project is being iterated on to improve reliability, add more language support, and harden edge cases.

Built by [Sagar Kharal](https://github.com/Sagar-024) — MERN stack developer exploring AI agent architecture.

---

## License

MIT
