/**
 * Orchestrator Worker Extension
 *
 * Provides the `orchestrate_worker` tool used by the orchestrator-code skill.
 * Each invocation spawns a separate `pi` subprocess in JSON mode with an
 * isolated context window. Workers have full tool access (read, write, edit, bash).
 *
 * Worker model is resolved in this order:
 *   1. ORCHESTRATOR_WORKER_MODEL env var (e.g. "openrouter/qwen/qwen3.6-plus")
 *   2. ~/.pi/agent/orchestrator-worker-model config file (single line)
 *   3. Default: "claude-sonnet-4-5"
 *
 * Usage from the orchestrator:
 *   orchestrate_worker({ task_id: "T1", description: "...", ... })
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir, getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Worker model resolution
// ---------------------------------------------------------------------------

function resolveWorkerModel(): string {
  // 1. Environment variable
  if (process.env.ORCHESTRATOR_WORKER_MODEL) {
    return process.env.ORCHESTRATOR_WORKER_MODEL.trim();
  }

  // 2. Config file
  const configPath = path.join(getAgentDir(), "orchestrator-worker-model");
  try {
    const content = fs.readFileSync(configPath, "utf-8").trim();
    if (content) return content;
  } catch {
    // file doesn't exist or isn't readable — fall through
  }

  // 3. Default
  return "claude-sonnet-4-5";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

function shortenPath(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

function getPiCommand(): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) return { command: process.execPath, args: [] };
  return { command: "pi", args: [] };
}

interface WorkerUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

interface WorkerResult {
  taskId: string;
  description: string;
  exitCode: number;
  summary: string;
  concerns: string;
  filesModified: string[];
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  usage: WorkerUsage;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
}

interface WorkerDetails {
  results: WorkerResult[];
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildWorkerSystemPrompt(params: {
  description: string;
  files_to_read?: string[];
  files_to_edit?: string[];
  acceptance_criteria?: string[];
  constraints?: string[];
  project_context?: string;
}): string {
  const parts: string[] = [];

  parts.push("You are an implementation worker. You operate in an isolated context to handle a single delegated coding task.");
  parts.push("");
  parts.push("**IMPORTANT: Use the edit/write tools to make changes to files on disk.**");
  parts.push("Do NOT just describe what to change — actually make the edits.");
  parts.push("");
  parts.push("Work autonomously to complete the assigned task below. Use all available tools as needed.");
  parts.push("");
  parts.push("---");
  parts.push("");
  parts.push(`## Task: ${params.description}`);
  parts.push("");

  if (params.project_context) {
    parts.push("## Project Context");
    parts.push(params.project_context);
    parts.push("");
  }

  if (params.files_to_read && params.files_to_read.length > 0) {
    parts.push("## Files to Read for Context");
    for (const f of params.files_to_read) {
      parts.push(`- \`${f}\``);
    }
    parts.push("");
  }

  if (params.files_to_edit && params.files_to_edit.length > 0) {
    parts.push("## Files to Edit");
    for (const f of params.files_to_edit) {
      parts.push(`- \`${f}\``);
    }
    parts.push("");
  }

  if (params.acceptance_criteria && params.acceptance_criteria.length > 0) {
    parts.push("## Acceptance Criteria");
    for (let i = 0; i < params.acceptance_criteria.length; i++) {
      parts.push(`${i + 1}. ${params.acceptance_criteria[i]}`);
    }
    parts.push("");
  }

  if (params.constraints && params.constraints.length > 0) {
    parts.push("## Constraints");
    for (const c of params.constraints) {
      parts.push(`- ${c}`);
    }
    parts.push("");
  }

  parts.push("## When Finished");
  parts.push("");
  parts.push("After making your edits, output a final message with these sections:");
  parts.push("");
  parts.push("### Summary");
  parts.push("A 1-2 sentence description of what was implemented.");
  parts.push("");
  parts.push("### Files Modified");
  parts.push("- `path/to/file.ts` — what changed");
  parts.push("");
  parts.push("### Concerns (if any)");
  parts.push("Any edge cases, risks, or things the orchestrator should know about.");
  parts.push("If none, write 'None.'");

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const OrchestrateWorkerParams = Type.Object({
  task_id: Type.String({
    description: "Unique task identifier (e.g. T1, T2) for tracking",
  }),
  description: Type.String({
    description: "Clear description of what to implement",
  }),
  files_to_read: Type.Optional(
    Type.Array(Type.String(), {
      description: "Files the worker should read for context before editing",
    }),
  ),
  files_to_edit: Type.Optional(
    Type.Array(Type.String(), {
      description: "Files the worker should modify (exact paths)",
    }),
  ),
  acceptance_criteria: Type.Optional(
    Type.Array(Type.String(), {
      description: "Verifiable criteria the implementation must satisfy",
    }),
  ),
  constraints: Type.Optional(
    Type.Array(Type.String(), {
      description: "Rules to follow (e.g. 'Follow existing code style', 'Do not modify imports unless necessary')",
    }),
  ),
  project_context: Type.Optional(
    Type.String({
      description: "Brief context about the project (stack, conventions, patterns)",
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description: "Working directory for the worker process (defaults to current)",
    }),
  ),
});

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "orchestrate_worker",
    label: "Orchestrate Worker",
    description:
      "Dispatch a coding task to an isolated worker agent. The worker has full tool access and will edit files on disk. Use this to parallelize implementation work — dispatch multiple workers simultaneously for independent tasks.",
    promptSnippet:
      "Dispatch a coding task to an isolated worker agent for implementation",
    promptGuidelines: [
      "Use orchestrate_worker to dispatch independent implementation tasks in parallel. Each worker gets an isolated context and full tool access (read, write, edit, bash). Dispatch all independent tasks simultaneously, then verify each result. Workers edit files directly on disk.",
    ],
    parameters: OrchestrateWorkerParams,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const workerModel = resolveWorkerModel();
      const cwd = params.cwd ?? ctx.cwd;
      const systemPrompt = buildWorkerSystemPrompt(params);

      // Build pi invocation args
      const piCmd = getPiCommand();
      const args = [...piCmd.args, "--mode", "json", "-p", "--no-session", "--model", workerModel];

      // Write system prompt to temp file to avoid shell escaping issues
      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-orch-worker-"));
      const promptPath = path.join(tmpDir, "prompt.md");
      await fs.promises.writeFile(promptPath, systemPrompt, { encoding: "utf-8", mode: 0o600 });

      const result: WorkerResult = {
        taskId: params.task_id,
        description: params.description,
        exitCode: 0,
        summary: "",
        concerns: "",
        filesModified: [],
        toolCalls: [],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
        model: workerModel,
      };

      const emitUpdate = () => {
        onUpdate?.({
          content: [{ type: "text", text: result.summary || "(running...)" }],
          details: { results: [result] } satisfies WorkerDetails,
        });
      };

      // Parse the worker's final message to extract structured sections
      const parseFinalOutput = (text: string) => {
        // Extract Summary section
        const summaryMatch = text.match(/###\s*Summary\s*\n([\s\S]*?)(?=###|$)/i);
        if (summaryMatch) result.summary = summaryMatch[1].trim();

        // Extract Files Modified
        const filesMatch = text.match(/###\s*Files\s*Modified\s*\n([\s\S]*?)(?=###|$)/i);
        if (filesMatch) {
          const fileLines = filesMatch[1].trim().split("\n");
          for (const line of fileLines) {
            const pathMatch = line.match(/`([^`]+)`/);
            if (pathMatch) result.filesModified.push(pathMatch[1]);
          }
        }

        // Extract Concerns
        const concernsMatch = text.match(/###\s*Concerns[^)]*\)?\s*\n([\s\S]*?)(?=###|$)/i);
        if (concernsMatch) {
          const concerns = concernsMatch[1].trim();
          if (concerns.toLowerCase() !== "none" && concerns.toLowerCase() !== "none.") {
            result.concerns = concerns;
          }
        }

        // If no structured output, use the whole text as summary
        if (!result.summary) result.summary = text.trim();
      };

      let wasAborted = false;

      try {
        args.push(`@${promptPath}`, "Complete the task described in the attached prompt file.");

        const exitCode = await new Promise<number>((resolve) => {
          const proc = spawn(piCmd.command, args, {
            cwd,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, PI_CODING_AGENT_DIR: getAgentDir() },
          });

          let stdoutBuffer = "";

          const processLine = (line: string) => {
            if (!line.trim()) return;
            let event: any;
            try {
              event = JSON.parse(line);
            } catch {
              return;
            }

            // Track tool calls
            if (event.type === "tool_call" || event.type === "tool_execution_start") {
              const name = event.toolName || event.name;
              const args = event.input || event.args || event.arguments || {};
              result.toolCalls.push({ name, args });
              emitUpdate();
            }

            // Track messages
            if (event.type === "message_end" && event.message) {
              const msg = event.message;
              if (msg.role === "assistant") {
                result.usage.turns++;
                if (msg.usage) {
                  result.usage.input += msg.usage.input || 0;
                  result.usage.output += msg.usage.output || 0;
                  result.usage.cacheRead += msg.usage.cacheRead || 0;
                  result.usage.cacheWrite += msg.usage.cacheWrite || 0;
                  result.usage.cost += msg.usage.cost?.total || 0;
                  result.usage.contextTokens = msg.usage.totalTokens || 0;
                }
                if (!result.model && msg.model) result.model = msg.model;
                if (msg.stopReason) result.stopReason = msg.stopReason;
                if (msg.errorMessage) result.errorMessage = msg.errorMessage;

                // Parse structured output from final assistant message
                for (const part of msg.content) {
                  if (part.type === "text") parseFinalOutput(part.text);
                }
                emitUpdate();
              }
            }
          };

          proc.stdout.on("data", (data: Buffer) => {
            stdoutBuffer += data.toString();
            const lines = stdoutBuffer.split("\n");
            stdoutBuffer = lines.pop() || "";
            for (const line of lines) processLine(line);
          });

          let stderrOutput = "";
          proc.stderr.on("data", (data: Buffer) => {
            stderrOutput += data.toString();
          });

          proc.on("close", (code) => {
            if (stdoutBuffer.trim()) processLine(stdoutBuffer);
            if (stderrOutput && !result.errorMessage) {
              result.errorMessage = stderrOutput.trim();
            }
            resolve(code ?? 0);
          });

          proc.on("error", () => resolve(1));

          if (signal) {
            const killProc = () => {
              wasAborted = true;
              proc.kill("SIGTERM");
              setTimeout(() => {
                if (!proc.killed) proc.kill("SIGKILL");
              }, 5000);
            };
            if (signal.aborted) killProc();
            else signal.addEventListener("abort", killProc, { once: true });
          }
        });

        result.exitCode = exitCode;
        if (wasAborted) throw new Error("Worker was aborted");
      } finally {
        // Cleanup temp files
        try {
          fs.unlinkSync(promptPath);
          fs.rmdirSync(tmpDir);
        } catch {
          /* ignore */
        }
      }

      const isError = result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
      if (isError) {
        const errorMsg = result.errorMessage || result.summary || "(no output)";
        return {
          content: [
            {
              type: "text",
              text: `[${result.taskId}] Worker failed (${result.stopReason || `exit ${result.exitCode}`}): ${errorMsg}`,
            },
          ],
          details: { results: [result] } satisfies WorkerDetails,
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: result.summary || "(no output)",
          },
        ],
        details: { results: [result] } satisfies WorkerDetails,
      };
    },

    // -----------------------------------------------------------------------
    // TUI rendering
    // -----------------------------------------------------------------------

    renderCall(args, theme, _context) {
      const taskId = args.task_id || "?";
      const preview =
        args.description && args.description.length > 60
          ? `${args.description.slice(0, 60)}...`
          : args.description || "...";

      let text =
        theme.fg("toolTitle", theme.bold("orchestrate_worker ")) +
        theme.fg("accent", taskId);

      text += `\n  ${theme.fg("dim", preview)}`;

      if (args.files_to_edit && args.files_to_edit.length > 0) {
        const files = args.files_to_edit.slice(0, 3);
        for (const f of files) {
          text += `\n  ${theme.fg("muted", "→ ")}${theme.fg("accent", shortenPath(f))}`;
        }
        if (args.files_to_edit.length > 3) {
          text += `\n  ${theme.fg("muted", `... +${args.files_to_edit.length - 3} more`)}`;
        }
      }

      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      const details = result.details as WorkerDetails | undefined;
      if (!details || details.results.length === 0) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
      }

      const r = details.results[0];
      const isError = r.exitCode !== 0 || r.stopReason === "error" || r.stopReason === "aborted";
      const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
      const mdTheme = getMarkdownTheme();

      if (expanded) {
        const container = new Container();

        // Header
        let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.taskId))}`;
        if (r.model) header += theme.fg("muted", ` (${r.model})`);
        if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
        container.addChild(new Text(header, 0, 0));
        if (isError && r.errorMessage) {
          container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
        }

        // Task
        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
        container.addChild(new Text(theme.fg("dim", r.description), 0, 0));

        // Tool calls
        if (r.toolCalls.length > 0) {
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("muted", "─── Tool Calls ───"), 0, 0));
          for (const tc of r.toolCalls) {
            const argsStr = JSON.stringify(tc.args);
            const preview = argsStr.length > 60 ? `${argsStr.slice(0, 60)}...` : argsStr;
            container.addChild(
              new Text(
                theme.fg("muted", "→ ") +
                  theme.fg("accent", tc.name) +
                  theme.fg("dim", ` ${preview}`),
                0,
                0,
              ),
            );
          }
        }

        // Summary
        if (r.summary) {
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("muted", "─── Summary ───"), 0, 0));
          container.addChild(new Markdown(r.summary.trim(), 0, 0, mdTheme));
        }

        // Files modified
        if (r.filesModified.length > 0) {
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("muted", "─── Files Modified ───"), 0, 0));
          for (const f of r.filesModified) {
            container.addChild(new Text(theme.fg("accent", `  ${f}`), 0, 0));
          }
        }

        // Concerns
        if (r.concerns) {
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("warning", "─── Concerns ───"), 0, 0));
          container.addChild(new Text(theme.fg("dim", r.concerns), 0, 0));
        }

        // Usage
        const usageParts: string[] = [];
        if (r.usage.turns) usageParts.push(`${r.usage.turns} turn${r.usage.turns > 1 ? "s" : ""}`);
        if (r.usage.input) usageParts.push(`↑${formatTokens(r.usage.input)}`);
        if (r.usage.output) usageParts.push(`↓${formatTokens(r.usage.output)}`);
        if (r.usage.cacheRead) usageParts.push(`R${formatTokens(r.usage.cacheRead)}`);
        if (r.usage.cacheWrite) usageParts.push(`W${formatTokens(r.usage.cacheWrite)}`);
        if (r.usage.cost) usageParts.push(`$${r.usage.cost.toFixed(4)}`);
        if (r.usage.contextTokens) usageParts.push(`ctx:${formatTokens(r.usage.contextTokens)}`);
        const usageStr = usageParts.join(" ");
        if (usageStr) {
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
        }

        return container;
      }

      // Collapsed view
      let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.taskId))}`;
      if (r.model) text += theme.fg("muted", ` (${r.model})`);
      if (isError && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;

      if (isError && r.errorMessage) {
        text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
      } else if (r.summary) {
        const summaryLines = r.summary.split("\n").slice(0, 3);
        text += `\n${theme.fg("toolOutput", summaryLines.join("\n"))}`;
      } else {
        text += `\n${theme.fg("muted", "(no output)")}`;
      }

      if (r.filesModified.length > 0) {
        text += `\n${theme.fg("dim", `Files: ${r.filesModified.join(", ")}`)}`;
      }

      const usageParts: string[] = [];
      if (r.usage.turns) usageParts.push(`${r.usage.turns}t`);
      if (r.usage.input) usageParts.push(`↑${formatTokens(r.usage.input)}`);
      if (r.usage.output) usageParts.push(`↓${formatTokens(r.usage.output)}`);
      if (r.usage.cost) usageParts.push(`$${r.usage.cost.toFixed(3)}`);
      const usageStr = usageParts.join(" ");
      if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;

      text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;

      return new Text(text, 0, 0);
    },
  });
}
