# 🎯 Pi Orchestrator Skill

A [pi](https://github.com/mariozechner/pi-coding-agent) skill that brings **multi-agent orchestration** to your coding workflow. Instead of tackling large tasks alone, pi acts as an orchestrator — it plans the architecture, decomposes the work, dispatches tasks to a fleet of isolated worker agents, verifies each result, and integrates everything.

```
You: "Build a REST API with auth, rate limiting, and tests"
Pi:  [Architects] → [Decomposes into 8 tasks] → [Dispatches 5 workers in parallel] → [Verifies each] → [Integrates] → ✅ Done
```

---

## How It Works

The orchestrator skill splits coding into two roles:

| Role | Responsibility |
|------|---------------|
| **Orchestrator** (you + pi) | Architecture, task decomposition, worker dispatch, verification, integration |
| **Workers** (isolated pi subprocesses) | Focused implementation — each worker handles exactly one task with only the context it needs |

### The 5-Phase Workflow

```
┌─────────────┐    ┌──────────────┐    ┌───────────────┐    ┌──────────────┐    ┌──────────────┐
│ 1. UNDERSTAND│ → │  2. PLAN &   │ → │ 3. DEPLOY     │ → │ 4. VERIFY &  │ → │ 5. FINAL     │
│   & ARCHITECT│    │  DECOMPOSE   │    │    WORKERS    │    │  INTEGRATE   │    │  VALIDATION  │
└─────────────┘    └──────────────┘    └───────────────┘    └──────────────┘    └──────────────┘
 Read codebase        Break into        Dispatch parallel     Read modified      Lint, typecheck,
 Map architecture     independent       worker tasks,         files, check       run tests,
                      tasks with        wait for results      acceptance         report results
                      clear criteria                          criteria
```

Workers run in **parallel** when tasks are independent, and **sequentially** when one task depends on another's output. The orchestrator never writes implementation code — it only verifies and integrates.

### Context Isolation

Each worker gets an isolated context window containing only:
- The file(s) it needs to edit
- Up to 2 supporting files for reference
- Project context (stack, conventions, patterns)
- Acceptance criteria and constraints

This means workers are fast, focused, and cheap — no context pollution from unrelated code.

---

## Installation

### 1. Install Pi

```bash
npm install -g @mariozechner/pi-coding-agent
```

### 2. Install the Skill

Clone this repo and symlink the skill into pi's agents directory:

```bash
git clone https://github.com/YOUR_USER/pi-orchestrator-skill.git
mkdir -p ~/.pi/agent/skills/
ln -s $(pwd)/pi-orchestrator-skill/.agents/skills/orchestrator-code ~/.pi/agent/skills/orchestrator-code
```

### 3. Install the Worker Extension

```bash
mkdir -p ~/.pi/agent/extensions/orchestrator-worker/
cp pi-orchestrator-skill/.pi/agent/extensions/orchestrator-worker/index.ts ~/.pi/agent/extensions/orchestrator-worker/index.ts
```

### 4. Configure the Worker Model (Recommended)

Workers need a capable, fast, and cost-effective model. Set your preferred worker model:

**Option A — Environment variable (per-session):**
```bash
export ORCHESTRATOR_WORKER_MODEL="openrouter/qwen/qwen3.6-plus"
pi
```

**Option B — Config file (persistent):**
```bash
echo "openrouter/qwen/qwen3.6-plus" > ~/.pi/agent/orchestrator-worker-model
```

**Option C — Default:**
Uses `claude-sonnet-4-5` if no config is set. Requires `ANTHROPIC_API_KEY`.

> **Recommended worker models:** Qwen 3.6 Plus (fast & cheap), Claude Sonnet 4 (very capable), GPT-4o (balanced). The orchestrator itself runs on whatever model your pi session is using.

---

## Usage

Trigger orchestration with natural language. Any of these patterns work:

```
orchestrate building a user management CRUD API
orchestrate refactoring the payment service into modules
orchestrate task: add rate limiting to all endpoints
orchestrator mode: migrate from REST to GraphQL
use the orchestrator for implementing the auth system
```

For simple, single-file tasks, pi will skip orchestration and handle it directly — no unnecessary overhead.

### During an Orchestration Run

Pi will display:

1. **Plan summary** — architecture approach, task breakdown with dependencies, parallel batches
2. **Progress updates** — live status for each worker (`✅ T1 complete`, `⏳ T3 in progress...`)
3. **Verification results** — which files were modified, whether acceptance criteria were met
4. **Completion report** — all files changed, lint/typecheck/test results

If a worker's output doesn't meet the acceptance criteria, pi automatically re-dispatches the task with correction instructions.

---

## Repository Structure

```
pi-orchestrator-skill/
├── README.md                                          ← You are here
├── .agents/
│   └── skills/
│       └── orchestrator-code/
│           ├── SKILL.md                               ← Skill definition & orchestration protocol
│           └── orchestrator-worker/
│               └── index.ts                           ← Companion extension (source)
└── .pi/
    └── agent/
        └── extensions/
            └── orchestrator-worker/
                └── index.ts                           ← Extension (install target)
```

| File | Purpose |
|------|---------|
| `.agents/skills/orchestrator-code/SKILL.md` | The skill definition — loaded by pi to enable orchestration mode. Contains the full workflow protocol, worker dispatch templates, verification checklist, and error handling rules. |
| `.agents/skills/orchestrator-code/orchestrator-worker/index.ts` | Source for the `orchestrate_worker` extension that pi loads to provide the worker dispatch tool. |
| `.pi/agent/extensions/orchestrator-worker/index.ts` | Install target — copy this to `~/.pi/agent/extensions/orchestrator-worker/`. |

---

## Configuration Reference

### Worker Model Resolution Order

1. `ORCHESTRATOR_WORKER_MODEL` environment variable
2. `~/.pi/agent/orchestrator-worker-model` config file
3. Default: `claude-sonnet-4-5`

### Switching Mid-Session

```bash
# In a pi session, change the model for subsequent workers:
echo "openai/gpt-4o" > ~/.pi/agent/orchestrator-worker-model
```

No restart needed — the change takes effect on the next worker dispatch.

### Orchestrator Model

The orchestrator runs on your pi session's current model. Switch with:

```
/model openrouter/anthropic/claude-sonnet-4-5
```

Or at startup: `pi --model openrouter/anthropic/claude-sonnet-4-5`

---

## Example Walkthrough

**Task:** "Orchestrate adding a POST /api/users endpoint to this Express API"

```
## Orchestration Plan

Task: Add POST /api/users endpoint
Worker Model: openrouter/qwen/qwen3.6-plus

### Architecture
Add a new users route with input validation using zod, a controller handling
the creation logic, and registration in the main app router.

### Task Breakdown
| ID | Description                           | File                         | Depends On |
|----|---------------------------------------|------------------------------|------------|
| T1 | Add validation schema (zod)           | src/validation/users.ts      | —          |
| T2 | Add controller (create user logic)    | src/controllers/users.ts     | —          |
| T3 | Add route definition                  | src/routes/users.ts          | —          |
| T4 | Register route in app                 | src/app.ts                   | T3         |

Parallel batches: {T1, T2, T3} → {T4}

Dispatching workers now...
───
✅ T1 complete — zod schema with email, name, password validation
✅ T2 complete — createUser controller with bcrypt hashing
✅ T3 complete — POST /api/users route with validation middleware
⏳ T4 in progress...
✅ T4 complete — route registered in app.ts
───
## Orchestration Complete

Task: Add POST /api/users endpoint
Workers deployed: 4 | Tasks completed: 4/4 | Failures: 0

### Files Modified
- src/validation/users.ts — Added CreateUserSchema (zod)
- src/controllers/users.ts — Added createUser controller
- src/routes/users.ts — Added POST /api/users route
- src/app.ts — Registered users router

### Verification
✅ Lint passes
✅ Type check passes
✅ Tests: 12 passed, 0 failed
```

---

## When to Use

**Great for:**
- Feature implementation across multiple files (new API endpoint, new component tree)
- Large refactors (splitting monolith modules, migrating patterns)
- Cross-cutting changes (adding auth to multiple routes, updating types across layers)
- Parallelizable work (building several independent components simultaneously)

**Skip for:**
- Single-file, single-change tasks (adding a comment, fixing one line)
- Trivial changes with no decomposition benefit
- Tasks where all steps are tightly sequential with no parallelism opportunity

Pi automatically decides whether to orchestrate or handle directly — no manual mode switching needed.

---

## Requirements

- **Node.js** ≥ 18
- **pi** — [@mariozechner/pi-coding-agent](https://github.com/mariozechner/pi-coding-agent)
- API key for your worker model provider (OpenRouter, Anthropic, OpenAI, etc.)
- API key for your orchestrator model provider (same or different)

---

## License

MIT
