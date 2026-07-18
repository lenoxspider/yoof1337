import type { LlmClient } from "../llm/client.js";
import type { AgentConfig } from "../config.js";
import { toolDefinitions, executeTool } from "../tools/definitions.js";
import type { SandboxContext } from "../tools/sandbox.js";
import { requestPermission, type PermissionOptions } from "../permissions/guardrails.js";
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
  onToolEnd?: (toolName: string, result: string, approved: boolean) => void;
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

  for (let iteration = 0; iteration < config.maxToolIterationsPerTurn; iteration++) {
    if (shouldCompact(state.messages, client, config.compaction)) {
      io.print(color("compacting context...", ansi.dim));
      await compact(state, client, config.compaction, { cwdForRepoSnapshot: sandbox.root });
    }

    let response;
    try {
      response = await client.chat(state.messages, toolDefinitions());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      io.print(color(`LLM error: ${msg}`, ansi.red));
      return;
    }

    if (response.toolCalls.length === 0) {
      // Final text -- display and end the turn.
      state.messages.push({ role: "assistant", content: response.text ?? "" });
      const out = response.text ?? "(no response text)";
      io.print(io.format ? io.format(out) : out);
      return;
    }

    state.messages.push({
      role: "assistant",
      content: response.text,
      toolCalls: response.toolCalls,
    });
    if (response.text) {
      const out = io.format ? io.format(response.text) : response.text;
      io.print(out);
    }

    for (const call of response.toolCalls) {
      io.print(
        `${color("tool", ansi.gray)} ${color(call.name, ansi.cyan)} ${color(truncateJson(call.input, 180), ansi.dim)}`
      );
      io.onToolStart?.(call.name, call.input);
      const decision = await requestPermission(call.name, call.input, permissions, io.rl);
      let result: string;
      if (!decision.approved) {
        result = `Tool call denied: ${decision.reason}`;
        io.print(color("denied", ansi.yellow));
        io.onToolEnd?.(call.name, result, false);
      } else {
        result = await executeTool(call.name, call.input, sandbox);
        trackWorldState(state, call.name, call.input);
        io.print(color("done", ansi.green));
        io.onToolEnd?.(call.name, result, true);
      }
      state.messages.push({ role: "tool", toolCallId: call.id, content: result });
    }
  }

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
}

function truncateJson(obj: unknown, max: number): string {
  const raw = JSON.stringify(obj);
  if (raw.length <= max) return raw;
  return raw.slice(0, max) + "...";
}
