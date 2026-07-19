import type { LlmClient } from "../llm/client.js";
import type { AgentConfig } from "../config.js";
import { execa } from "execa";
import type { SandboxContext } from "../tools/sandbox.js";
import { requestPermission, type PermissionOptions } from "../permissions/guardrails.js";
import { executeTool } from "../tools/definitions.js";
import { registry } from "../tools/registry.js";
import type { AgentState } from "./state.js";
import { shouldCompact, compact } from "./compaction.js";
import { ansi, color } from "../cli/ui.js";
import { renderMarkdownToPlain } from "../cli/markdown.js";

type Questioner = { question: (prompt: string) => Promise<string>; isTui?: boolean };

export interface LoopIO {
  /** Assistant-facing output (final text, tool activity). */
  print: (text: string) => void;
  /** Shared questioner for permission prompts; omit in non-interactive use. */
  rl?: Questioner;
  /** Optional output formatter (e.g., markdown renderer). */
  format?: (text: string) => string;
  onToolStart?: (toolName: string, input: Record<string, unknown>) => void;
  onToolEnd?: (toolName: string, result: string, approved: boolean, durationMs: number) => void;
  /** Optional formatter for tool results printed to the transcript. */
  formatToolResult?: (toolName: string, result: string) => string;
  /** Optional cancellation signal for long turns. */
  abortSignal?: AbortSignal;
  /** Session logger for append-only persistence. */
  sessionLogger?: import("../sessions/logger.js").SessionLogger;
}

/**
 * Core agent loop: send messages + tool definitions to the LLM; execute any
 * requested tool calls (behind the permission system) and feed results back;
 * stop when the model responds with final text or the iteration cap is hit.
 */
export async function runTurn(
  state: AgentState,
  userInput: string,
  client: LlmClient,
  config: AgentConfig,
  sandbox: SandboxContext,
  permissions: PermissionOptions,
  io: LoopIO
): Promise<void> {
  if (state.originalTask === null) state.originalTask = userInput;
  state.messages.push({ role: "user", content: userInput });
  if (io.sessionLogger) {
    await io.sessionLogger.logSync({ type: "user", content: userInput, originalTask: state.originalTask });
  }

  for (let iteration = 0; iteration < config.maxToolIterationsPerTurn; iteration++) {
    if (io.abortSignal?.aborted) {
      io.print(color("Canceled.", ansi.yellow));
      return;
    }
    if (shouldCompact(state, client, config.compaction)) {
      io.print(color("compacting context...", ansi.dim));
      await compact(state, client, config.compaction, { cwdForRepoSnapshot: sandbox.root, sessionLogger: io.sessionLogger });
    }

    let response;
    try {
      response = await client.chat(state.messages, registry.getDefinitions());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      io.print(color(`LLM error: ${msg}`, ansi.red));
      return;
    }

    if (response.toolCalls.length === 0) {
      // Final text -- display and end the turn.
      state.messages.push({ role: "assistant", content: response.text ?? "" });
      if (io.sessionLogger) io.sessionLogger.logAsync({ type: "assistant", content: response.text ?? "" });
      const out = response.text ?? "(no response text)";
      io.print(io.format ? io.format(out) : out);
      return;
    }

    state.messages.push({
      role: "assistant",
      content: response.text,
      toolCalls: response.toolCalls,
    });
    if (io.sessionLogger) io.sessionLogger.logAsync({ type: "assistant", content: response.text ?? "", toolCalls: response.toolCalls });
    
    if (response.text) {
      const out = io.format ? io.format(response.text) : response.text;
      io.print(out);
    }

    for (const call of response.toolCalls) {
      if (io.abortSignal?.aborted) {
        io.print(color("Canceled.", ansi.yellow));
        return;
      }
      io.print(
        `${color("tool", ansi.gray)} ${color(call.name, ansi.cyan)} ${color(truncateJson(call.input, 180), ansi.dim)}`
      );
      io.onToolStart?.(call.name, call.input);
      const currentPermissions: PermissionOptions = {
        ...permissions,
        hooks: config.hooks?.preToolUse,
        rules: config.permissions,
      };
      const decision = await requestPermission(call.name, call.input, currentPermissions, io.rl);
      let result: string;
      if (!decision.approved) {
        result = `Tool call denied: ${decision.reason}`;
        io.print(color("denied", ansi.yellow));
        io.onToolEnd?.(call.name, result, false, 0);
      } else {
        if (registry.get(call.name)?.mutating) {
          try {
            await execa("git", ["add", "."], { cwd: sandbox.root, windowsHide: true });
            const st = await execa("git", ["status", "--porcelain"], { cwd: sandbox.root, windowsHide: true });
            if (st.stdout.trim()) {
              await execa("git", ["commit", "-m", `[yoof1337-auto] checkpoint before ${call.name}`], {
                cwd: sandbox.root,
                windowsHide: true,
              });
            }
          } catch (e) {
            // Ignore checkpointing errors
          }
        }
        
        const t0 = Date.now();
        result = await executeTool(call.name, decision.input ?? call.input, sandbox);
        const dt = Date.now() - t0;
        trackWorldState(state, call.name, decision.input ?? call.input);
        io.print(color("done", ansi.green));
        const formatted = io.formatToolResult ? io.formatToolResult(call.name, result) : defaultFormatToolResult(call.name, result);
        if (formatted) io.print(formatted);
        io.onToolEnd?.(call.name, result, true, dt);
      }
      state.messages.push({ role: "tool", toolCallId: call.id, content: result });
      if (io.sessionLogger) {
        io.sessionLogger.logAsync({ type: "tool", toolCallId: call.id, content: result });
        // After a tool runs, world state might have changed, so we log progress inline
        io.sessionLogger.logAsync({ type: "progress", world: state.world });
      }
    }
  }

  if (io.sessionLogger) await io.sessionLogger.flush();

  io.print(
    color(
      `Stopped: reached the per-turn tool iteration limit (${config.maxToolIterationsPerTurn}). Send another message to continue.`,
      ansi.yellow
    )
  );
}

function trackWorldState(state: AgentState, toolName: string, input: Record<string, unknown>): void {
  if (toolName === "write_file" && typeof input.path === "string") {
    state.world.filesTouched.add(input.path);
  }
  if (toolName === "run_command" && typeof input.command === "string") {
    state.world.commandsRun.push(input.command);
  }
  if (toolName === "run_command_bg" && typeof input.command === "string") {
    state.world.bgCommandsRun.push(input.command);
  }
}

function truncateJson(obj: unknown, max: number): string {
  const raw = JSON.stringify(obj);
  if (raw.length <= max) return raw;
  return raw.slice(0, max) + "...";
}

function defaultFormatToolResult(toolName: string, result: string): string {
  const header = `${color("result", ansi.gray)} ${color(toolName, ansi.cyan)}`;
  const body = truncateBlock(String(result ?? ""), 4000, 120);
  return `${header}\n${body}`;
}

function truncateBlock(s: string, maxChars: number, maxLines: number): string {
  const lines = s.split(/\r?\n/);
  const sliced = lines.slice(0, maxLines);
  let out = sliced.join("\n");
  if (lines.length > maxLines) out += `\n[truncated: ${lines.length - maxLines} more lines]`;
  if (out.length > maxChars) out = out.slice(0, maxChars) + `\n[truncated: ${out.length - maxChars} chars more]`;
  return out || "(empty)";
}
