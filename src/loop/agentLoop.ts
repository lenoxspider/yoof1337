import type { LlmClient, ChatMessage } from "../llm/client.js";
import { estimateTokens } from "../llm/client.js";
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

interface LoopDetectionState {
  consecutiveFailures: number;
  lastCallSignature: string | null;
  repeatCount: number;
}

const LOOP_FAILURE_THRESHOLD = 3;
const LOOP_REPEAT_THRESHOLD = 3;

function getCallSignature(name: string, input: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(input)}`;
}

function isFailureResult(result: string): boolean {
  const lower = result.toLowerCase();
  return (
    lower.startsWith("error:") ||
    lower.startsWith("tool call denied") ||
    lower.includes("sandbox violation") ||
    lower.includes("command failed") ||
    lower.includes("no such file") ||
    lower.includes("permission denied")
  );
}

/** Running tallies for a single turn, surfaced live and in the closing summary. */
export interface TurnProgress {
  /** ms since the turn started. */
  elapsedMs: number;
  /** Number of LLM round-trips so far. */
  llmCalls: number;
  /** Number of tool calls executed (approved or denied) so far. */
  toolCalls: number;
  /** Cumulative prompt/input tokens reported by the server. */
  promptTokens: number;
  /** Cumulative completion/output tokens reported by the server. */
  completionTokens: number;
  /** Prompt tokens from the most recent LLM call — the true context-window fill. */
  contextTokens: number;
  /** True once at least one server usage report has been seen. */
  hasUsage: boolean;
}

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
  /** Called once when the turn begins. */
  onTurnStart?: () => void;
  /** Called when an LLM request is dispatched, with a short activity label. */
  onLlmStart?: (activity: string) => void;
  /** Called when an LLM request returns, with the latest running tallies. */
  onLlmEnd?: (progress: TurnProgress) => void;
  /** Called with a phase label + running tallies whenever activity changes. */
  onProgress?: (activity: string, progress: TurnProgress) => void;
  /** Called once when the turn ends (final text, cap, cancel, or error). */
  onTurnEnd?: (progress: TurnProgress) => void;
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

  const loopState: LoopDetectionState = {
    consecutiveFailures: 0,
    lastCallSignature: null,
    repeatCount: 0,
  };

  const turnStart = Date.now();
  const tallies = { llmCalls: 0, toolCalls: 0, promptTokens: 0, completionTokens: 0, contextTokens: 0, hasUsage: false };
  const progress = (): TurnProgress => ({
    elapsedMs: Date.now() - turnStart,
    llmCalls: tallies.llmCalls,
    toolCalls: tallies.toolCalls,
    promptTokens: tallies.promptTokens,
    completionTokens: tallies.completionTokens,
    contextTokens: tallies.contextTokens,
    hasUsage: tallies.hasUsage,
  });
  io.onTurnStart?.();

  for (let iteration = 0; iteration < config.maxToolIterationsPerTurn; iteration++) {
    if (io.abortSignal?.aborted) {
      io.print(color("Canceled.", ansi.yellow));
      io.onTurnEnd?.(progress());
      return;
    }
    if (shouldCompact(state, client, config.compaction)) {
      io.print(color("compacting context...", ansi.dim));
      io.onProgress?.("compacting context", progress());
      await compact(state, client, config.compaction, { cwdForRepoSnapshot: sandbox.root, sessionLogger: io.sessionLogger });
    }

    pruneOversizedMessages(state.messages, Math.floor(client.contextWindow * 0.85));

    let response;
    try {
      io.onLlmStart?.(iteration === 0 ? "thinking" : "thinking");
      response = await client.chat(state.messages, registry.getActiveDefinitions(), io.abortSignal);
      tallies.llmCalls++;
      if (response.usage) {
        tallies.hasUsage = true;
        tallies.promptTokens += response.usage.promptTokens;
        tallies.completionTokens += response.usage.completionTokens;
        // Context fill = prompt tokens of the most recent call (whole history re-sent each round).
        tallies.contextTokens = response.usage.promptTokens;
      }
      io.onLlmEnd?.(progress());
    } catch (err) {
      if (io.abortSignal?.aborted) {
        io.print(color("Canceled.", ansi.yellow));
        io.onTurnEnd?.(progress());
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      io.print(color(`LLM error: ${msg}`, ansi.red));
      io.onTurnEnd?.(progress());
      return;
    }

    if (response.toolCalls.length === 0) {
      // Final text -- display and end the turn.
      state.messages.push({ role: "assistant", content: response.text ?? "" });
      if (io.sessionLogger) io.sessionLogger.logAsync({ type: "assistant", content: response.text ?? "" });
      const out = response.text ?? "(no response text)";
      io.print(io.format ? io.format(out) : out);
      io.onTurnEnd?.(progress());
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
        io.onTurnEnd?.(progress());
        return;
      }
      tallies.toolCalls++;
      io.print(
        `${color("tool", ansi.gray)} ${color(call.name, ansi.cyan)} ${color(truncateJson(call.input, 180), ansi.dim)}`
      );
      io.onToolStart?.(call.name, call.input);
      tallies.toolCalls++;
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
      const maxStoredResultChars = 40_000;
      const storedResult =
        typeof result === "string" && result.length > maxStoredResultChars
          ? result.slice(0, maxStoredResultChars) + `\n\n[Stored output truncated: ${result.length} characters total]`
          : result;

      state.messages.push({ role: "tool", toolCallId: call.id, content: storedResult });
      if (io.sessionLogger) {
        io.sessionLogger.logAsync({ type: "tool", toolCallId: call.id, content: storedResult });
        io.sessionLogger.logAsync({ type: "progress", world: state.world });
      }

      // Loop detection: track repeated calls and consecutive failures
      const callSig = getCallSignature(call.name, call.input);
      if (isFailureResult(result)) {
        loopState.consecutiveFailures++;
      } else {
        loopState.consecutiveFailures = 0;
      }

      if (callSig === loopState.lastCallSignature) {
        loopState.repeatCount++;
      } else {
        loopState.lastCallSignature = callSig;
        loopState.repeatCount = 1;
      }

      if (loopState.consecutiveFailures >= LOOP_FAILURE_THRESHOLD) {
        io.print(color(
          `Paused: ${loopState.consecutiveFailures} consecutive tool failures detected. The model may be stuck.`,
          ansi.yellow
        ));
        state.messages.push({ role: "user", content: "[system] You have failed the same operation multiple times in a row. Stop and explain what is going wrong, then try a different approach." });
        loopState.consecutiveFailures = 0;
        break;
      }
      if (loopState.repeatCount >= LOOP_REPEAT_THRESHOLD) {
        io.print(color(
          `Paused: identical tool call repeated ${loopState.repeatCount} times. The model appears to be looping.`,
          ansi.yellow
        ));
        state.messages.push({ role: "user", content: "[system] You are repeating the same tool call with the same arguments. This is unproductive. Stop and try a fundamentally different approach or explain why you are stuck." });
        loopState.repeatCount = 0;
        loopState.lastCallSignature = null;
        break;
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
  io.onTurnEnd?.(progress());
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
  if (toolName === "note_decision" && typeof input.decision === "string") {
    const decision = input.decision.trim();
    if (decision && !state.world.memory.decisions.includes(decision)) {
      state.world.memory.decisions.push(decision);
    }
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

function pruneOversizedMessages(messages: ChatMessage[], maxTokens: number): void {
  if (estimateTokens(messages) <= maxTokens) return;
  // Truncate oldest tool results first
  for (let i = 1; i < messages.length - 2; i++) {
    const m = messages[i];
    if (m.role === "tool" && typeof m.content === "string" && m.content.length > 500) {
      m.content = m.content.slice(0, 500) + "\n\n[Earlier tool output pruned to stay within context limit]";
      if (estimateTokens(messages) <= maxTokens) return;
    }
  }
}

