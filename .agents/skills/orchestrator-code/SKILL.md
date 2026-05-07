---
name: orchestrator-code
description: Orchestrates coding tasks using a planner-architect orchestrator and a fleet of worker agents. The orchestrator handles architecture, decomposition, and verification; workers handle implementation.
version: 2.0.0
author: Secretary Mary
keywords:
  - orchestrate
  - orchestrate task
  - orchestrate build
  - orchestrate implement
  - orchestrate refactor
  - orchestrate fix
  - worker fleet
  - multi-agent
  - parallel coding
  - distributed coding
patterns:
  - /orchestrate\s+(?:task\s*:?\s*)?(.+)/i
  - /orchestrate\s+(?:build|implement|refactor|fix)\s+(.+)/i
  - /use\s+(?:the\s+)?orchestrator\s+(?:for\s+|to\s+)?(.+)/i
  - /orchestrator\s+mode\s*:?\s*(.+)/i
  - /--orchestrate\s+(.+)/i
intents:
  - orchestrate_code
---

# Orchestrator Coding Skill (PI Edition)

Orchestrates complex coding tasks by splitting the work between a strategic orchestrator (architecture, planning, verification) and a fleet of implementation workers. The orchestrator thinks before acting, workers execute in parallel where possible, and every worker's output is verified before integration.

## Prerequisites

This skill requires the **orchestrator-worker extension**, which provides the `orchestrate_worker` tool used to dispatch workers. The extension is located at:

```
~/.pi/agent/extensions/orchestrator-worker/index.ts
```

If the `orchestrate_worker` tool is not available, tell the user to install the companion extension (should be alongside this SKILL.md in the same directory) into `~/.pi/agent/extensions/orchestrator-worker/`.

## Model Configuration

### How the Worker Model Is Set

The `orchestrate_worker` tool resolves its model in this order:

1. **Environment variable** — `ORCHESTRATOR_WORKER_MODEL` (e.g. `openrouter/qwen/qwen3.6-plus`)
2. **Config file** — `~/.pi/agent/orchestrator-worker-model` (single line with the model name)
3. **Default** — `claude-sonnet-4-5`

### Quick Setup

**Option A — Environment variable (easiest, per-session):**
```bash
export ORCHESTRATOR_WORKER_MODEL="openrouter/qwen/qwen3.6-plus"
pi
```

**Option B — Config file (persistent):**
```bash
echo "openrouter/qwen/qwen3.6-plus" > ~/.pi/agent/orchestrator-worker-model
```

**Option C — Use the default:**
Workers use `claude-sonnet-4-5` (Anthropic). Make sure `ANTHROPIC_API_KEY` is set.

### Choosing a Worker Model

Workers need a model that is:
- **Fast** — workers run in parallel, so speed matters for throughput
- **Good at following precise instructions** — workers receive structured prompts with clear acceptance criteria
- **Cost-effective** — you'll potentially run many worker invocations

Recommended:
- **Qwen 3.6 Plus** (`openrouter/qwen/qwen3.6-plus`) — fast, cheap, good at coding
- **Claude Sonnet 4** (`claude-sonnet-4-5`) — very capable, default
- **GPT-4o** (`openai/gpt-4o`) — solid balance

### Orchestrator Model

The orchestrator (you) runs on whatever model the user's current PI session is using. To switch, use `/model` or `Ctrl+L` in interactive mode, or `--model` at startup.

## Architecture

### Orchestrator Responsibilities

The orchestrator (this agent) is the **strategic controller**. It NEVER writes implementation code directly. Instead it:

1. **Analyzes** the request to understand scope, dependencies, and constraints
2. **Architects** the solution — file structure, data flow, component boundaries
3. **Decomposes** the work into discrete, independent tasks
4. **Dispatches** tasks to workers with precise, self-contained prompts via `orchestrate_worker`
5. **Verifies** each worker's output against acceptance criteria by reading modified files
6. **Integrates** verified outputs and runs final validation
7. **Reports** results back to the user

### Worker Responsibilities

Each worker is a **focused implementor**. A worker:

1. Receives exactly one task with full context (no back-and-forth needed)
2. Uses PI's tools (read, write, edit, bash) to make changes
3. Returns: files modified, a summary of what was done, and any concerns
4. Does NOT plan across tasks, coordinate with other workers, or verify other workers' output

### Why This Separation

- **Context efficiency**: Workers get only the files and context they need, not the entire codebase
- **Parallelism**: Independent tasks run simultaneously via multiple `orchestrate_worker` calls
- **Quality**: Orchestrator verification catches integration issues before they compound
- **Focus**: Each worker does one thing well; the orchestrator ensures the whole is coherent

## Workflow

### Phase 1: Understand & Architect

The orchestrator reads relevant files and maps the codebase. For each request:

1. Use `grep`, `find`, `ls`, and `read` to explore the codebase and identify relevant files
2. Read key files to understand patterns, interfaces, and data flow
3. Identify the architectural boundaries: which files handle what, how data flows
4. Draft a mental model of the solution architecture

**Output**: A clear understanding of what needs to change and where.

### Phase 2: Plan & Decompose

Break the work into tasks. Follow these rules:

- **Max 1 file per worker task** (a worker should not touch unrelated files)
- **Independent tasks run in parallel** — if task B depends on task A's output, they are sequential
- **Each task has clear acceptance criteria** — what must be true when done
- **Each task includes exact file paths** — no ambiguity about where code lives
- **Group tightly coupled edits** — if an interface and its implementation must match exactly, same worker handles both

Produce a brief plan showing:
- Tasks with IDs, descriptions, file targets, and dependencies
- Which tasks run in parallel (same batch) vs sequential

**Output**: A task plan (display to user as the orchestration overview).

### Phase 3: Deploy Workers

Dispatch workers using the `orchestrate_worker` tool.

#### Pre-flight Check

Before dispatching the first worker, verify the `orchestrate_worker` tool is available. If not, tell the user to install the companion extension (see Prerequisites above).

#### Parallelism Rules

- Dispatch ALL independent tasks in a **single message** with multiple `orchestrate_worker` tool calls
- For sequential tasks, dispatch batch 1, wait for ALL results, then dispatch batch 2
- Never dispatch a task that depends on a currently-running worker's output

#### Worker Dispatch Protocol

```
For each batch of parallel tasks:
  1. Prepare a task payload per worker (see template below)
  2. Dispatch all in one message with multiple orchestrate_worker() calls
  3. Await all results
  4. Run verification (Phase 4) on each result
  5. If a verification fails, re-dispatch to a new worker with the issue described
```

### Phase 4: Verify & Integrate

For each completed worker task:

1. **Read the modified files** with the `read` tool to confirm changes are present
2. **Check acceptance criteria** — did the worker produce what was asked?
3. **Check style consistency** — does the code follow existing patterns in the file/project?
4. **Check integration surface** — do type signatures, imports, and exports align with other workers' changes?

If any check fails, re-dispatch the task to a new worker with a clear description of the issue.

After ALL workers pass verification:

1. **Read all modified files** to build a complete picture
2. **Check cross-worker integration** — do the pieces fit together?
3. **Resolve any integration issues** with targeted follow-up worker tasks

### Phase 5: Final Validation

1. Run the project's linter via `bash` (`npm run lint`, `yarn lint`, `ruff`, etc.)
2. Run the project's type checker via `bash` (`npm run typecheck`, `tsc --noEmit`, etc.)
3. Run relevant tests if available
4. Verify no secrets, no debug code, no stray comments
5. Report final status to the user

## Worker Task Payload Template

Every `orchestrate_worker` dispatch MUST include these fields:

```
orchestrate_worker({
  task_id: "T1",                          // Unique identifier
  description: "Add input validation...",  // Clear implementation description
  files_to_read: [                         // Files worker should read for context
    "src/types.ts",                        // — interface definitions
    "src/validation/helpers.ts",          // — existing validation patterns
  ],
  files_to_edit: [                         // Files worker must modify (exact paths)
    "src/routes/users.ts",
  ],
  acceptance_criteria: [                   // Verifiable criteria
    "POST /api/users returns 400 with error message for missing 'email' field",
    "POST /api/users returns 400 when email is not a valid email address",
    "Existing valid requests still pass through unchanged",
  ],
  constraints: [                           // Rules the worker must follow
    "Follow existing code style in the file (indentation, naming, patterns)",
    "Do NOT modify imports unless necessary for the change",
    "Do NOT add comments unless the existing code uses them",
    "Return ONLY the edits needed — no extra refactoring",
  ],
  project_context: "Express.js API with TypeScript, using zod for validation. Routes in src/routes/, validation schemas in src/validation/. Error responses use { error: string } format."  // Brief context
})
```

### Context Injection Rules

- **Include only necessary context** — the target file(s) plus adjacent files the worker needs to understand interfaces
- **Pre-read files before dispatching** — the orchestrator reads files and includes their paths in `files_to_read` (the worker will read them)
- **Be specific about file paths** — use exact relative paths from the project root
- **Acceptance criteria must be verifiable** — concrete "what must be true" statements
- **Project context should be brief** — 2-4 sentences about stack, conventions, and relevant patterns

## Verification Checklist

After each worker returns, the orchestrator verifies by reading files with `read`:

| Check | What to look for |
|-------|-----------------|
| **Presence** | Are the claimed modifications actually in the file? |
| **Correctness** | Does the code match the acceptance criteria? |
| **Style** | Naming, indentation, patterns match surrounding code? |
| **Imports** | New imports needed? Unused imports left behind? |
| **Types** | Type errors visible? Type signatures consistent? |
| **Edge Cases** | Null/undefined handled? Error paths covered? |
| **No Overreach** | Worker didn't modify files outside their assigned scope? |
| **Security** | No secrets, no `eval`, no unsafe patterns? |

## Filesystem Strategy

The orchestrator manages a lightweight plan artifact in the conversation — no files written to disk for plans.

### File Access Pattern

1. Orchestrator reads files needed for architecture understanding
2. Orchestrator includes file paths in `files_to_read` for worker context (workers read the files themselves)
3. Workers edit files directly on disk
4. Orchestrator re-reads files after worker completion for verification

### Context Budgeting

- Workers get at most the file they edit + 2 supporting files
- If a task requires understanding more than 3 files, break it into smaller tasks
- Large files are handled by the worker reading only what's needed

## Integration & Assembly

When multiple workers modify the same file in parallel:

1. **Prefer NOT to do this** — decompose so each file has at most one worker
2. If unavoidable, serialize: worker 1 completes and is verified, then worker 2 gets the updated file
3. After all workers complete, the orchestrator reads the final file state and does a final reconciliation pass

When workers modify different files that import each other:

1. Orchestrator reads all modified files
2. Checks imports/exports align
3. If mismatch, dispatches a targeted fix task

## Response Formats

### Plan Summary (shown to user after Phase 2)

```
## Orchestration Plan

**Task**: [User's request summarized]
**Worker Model**: [current worker model]

### Architecture
[2-3 sentences about the solution approach]

### Task Breakdown
| ID | Description | File | Depends On |
|----|-------------|------|------------|
| T1 | [Description] | `path/to/file` | — |
| T2 | [Description] | `path/to/file` | — |
| T3 | [Description] | `path/to/file` | T1 |

**Parallel batches**: {T1, T2} → {T3}

Dispatching workers now...
```

### Progress Update (after each batch)

```
✅ T1 complete — [1-sentence result]
✅ T2 complete — [1-sentence result]
⏳ T3 in progress...
```

### Completion Report (after final validation)

```
## Orchestration Complete

**Task**: [User's request]
**Workers deployed**: 3 | **Tasks completed**: 3/3 | **Failures**: 0

### Files Modified
- `path/to/file1.ts` — [what changed]
- `path/to/file2.ts` — [what changed]
- `path/to/file3.ts` — [what changed]

### Verification
- ✅ Lint passes
- ✅ Type check passes
- ✅ Tests pass (or: no relevant tests found)
```

### Error / Re-dispatch

```
⚠️ T2 verification failed: [specific issue]
Re-dispatching T2 with correction: [what to fix]
```

## Examples

### Example 1: Add a New API Endpoint

**User**: "Orchestrate adding a POST /api/users endpoint to the Express app"

**Orchestrator Flow**:

1. **Understand**: Uses `find`, `ls`, and `read` to explore `src/routes/`, `src/controllers/`, `src/validation/`, `src/app.ts` to understand routing pattern
2. **Plan**:
   - T1: Add route definition in `src/routes/users.ts` (depends on: none)
   - T2: Add controller in `src/controllers/users.ts` (depends on: none — can work from interface spec)
   - T3: Add request validation schema in `src/validation/users.ts` (depends on: none)
   - T4: Register route in `src/app.ts` (depends on: T1 — needs the route name)
3. **Dispatch**: T1, T2, T3 in parallel → verify → T4 → verify
4. **Validate**: `bash` to run lint, type check

### Example 2: Refactor a Component

**User**: "Orchestrate refactoring the UserDashboard component — split it into smaller sub-components"

**Orchestrator Flow**:

1. **Understand**: Reads `src/components/UserDashboard.tsx` (300+ lines), identifies logical sections
2. **Plan**:
   - T1: Extract `UserHeader` sub-component (depends on: none)
   - T2: Extract `UserStats` sub-component (depends on: none)
   - T3: Extract `UserActivity` sub-component (depends on: none)
   - T4: Rewire `UserDashboard` to use new sub-components (depends on: T1, T2, T3)
3. **Dispatch**: T1, T2, T3 in parallel → verify all → T4 → verify
4. **Validate**: Lint, type check, verify no imports broken

### Example 3: Bug Fix with Cross-File Dependencies

**User**: "Orchestrate fixing the type mismatch between the API response and the frontend model in the Orders page"

**Orchestrator Flow**:

1. **Understand**: Reads `src/types/api.ts`, `src/types/models.ts`, `src/pages/Orders.tsx`, `src/api/orders.ts`
2. **Plan**:
   - T1: Fix type definition in `src/types/api.ts` (depends on: none)
   - T2: Update model mapping in `src/api/orders.ts` (depends on: T1 — needs updated type)
   - T3: Update component usage in `src/pages/Orders.tsx` (depends on: T2 — needs updated mapping)
3. **Dispatch**: T1 → verify → T2 → verify → T3 → verify
4. **Validate**: Type check, confirm the specific bug is resolved

### Example 4: Simple Task (No Orchestration)

**User**: "Orchestrate adding a comment to calculateTotal"

**Orchestrator Flow**:

1. **Understand**: This is a single-file, single-change task
2. **Decision**: "This task is simple enough that orchestration overhead isn't worth it. I'll handle it directly."
3. **Execute**: Uses `edit` directly to add the comment
4. **Report**: Tells the user why orchestration was skipped

## Error Handling

### Worker Failure

If a worker returns incomplete or incorrect output:
1. Identify the specific issue from the worker's result
2. Re-dispatch with a clear correction instruction (include what was wrong and what to fix)
3. If it fails again, the orchestrator handles the task directly as a fallback using `edit`/`write`
4. Report any fallback to the user

### Integration Conflict

If two workers' changes conflict:
1. Orchestrator reads both outputs
2. Resolves the conflict (merge, reconcile, or choose one approach)
3. Applies the resolution (either via a new worker task or directly with `edit`)

### Too Complex to Decompose

If a task is too tightly coupled to split:
1. Acknowledge this in the plan
2. Dispatch as a single larger task with more context
3. Note in the report that parallelism was not possible for this part

### Project Not Understood

If the orchestrator cannot map the codebase after reading key files:
1. Ask the user a targeted question about architecture
2. Do NOT proceed with decomposition until the architecture is clear

### Worker Model Not Configured

If the worker model fails (worker returns errors about authentication):
1. Check the current worker model with `echo $ORCHESTRATOR_WORKER_MODEL` or `cat ~/.pi/agent/orchestrator-worker-model`
2. Tell the user to set the model (see Model Configuration above)
3. Suggest a fallback to `claude-sonnet-4-5` if they have ANTHROPIC_API_KEY set

## Best Practices

1. **Prefer more smaller tasks** over fewer larger tasks — better parallelism, less context per worker
2. **Read files before dispatching workers** — understand the codebase, then assign precise tasks
3. **Verify immediately** — check each worker's output as soon as it returns with `read`, don't batch verification
4. **One file, one worker** (when possible) — avoids merge conflicts and confusion
5. **Clear acceptance criteria** — every task should have a verifiable "done" state
6. **Report progress** — users should see the orchestration plan and real-time progress
7. **Fall back gracefully** — if orchestration isn't beneficial (simple task, single file), just handle it directly and explain why
8. **Specify `files_to_read`** — give workers the context they need by listing files they should read first

## Tool Reference

The orchestrator uses these PI tools:

| Tool | Purpose |
|------|---------|
| `orchestrate_worker` | Dispatch implementation tasks to isolated workers |
| `read` | Read files for architecture understanding and worker verification |
| `edit` | Make targeted edits (used directly for simple tasks or integration fixes) |
| `write` | Create new files |
| `bash` | Run linters, type checkers, tests, and other shell commands |
| `grep` | Search codebase for patterns |
| `find` | Find files by name/pattern |
| `ls` | List directory contents |

## Switching Worker Model Mid-Session

To change the worker model during a pi session:

1. Edit the config file: `bash` with `echo "new-model" > ~/.pi/agent/orchestrator-worker-model`
2. The change takes effect on the next `orchestrate_worker` call — no restart needed

Or, to change for a single command:
```bash
ORCHESTRATOR_WORKER_MODEL="openai/gpt-4o" pi
```
