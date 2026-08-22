import type { ChatMessage, LlmClient } from "../llm/client.js";
import { estimateTokens } from "../llm/client.js";
import type { CompactionConfig } from "../config.js";
import type { AgentState } from "./state.js";
import { worldStateSummary } from "./state.js";
import { execa } from "execa";

const SUMMARIZE_INSTRUCTION = `You are summarizing a tool-using coding agent session for context compaction.
Return STRICT JSON ONLY with this schema:
{
  "objective": string,
  "decisions": string[],
  "open_questions": string[],
  "next_steps": string[],
  "summary": string
}
Rules:
- Keep it factual and specific. No prose outside JSON.
- Prefer short bullet-like strings in arrays.
- Do not include raw tool output; extract only the key facts.`;

export const COMPACT_BOUNDARY_MARKER = "[compact_boundary]";

export function shouldCompact(
  state: AgentState,
  client: LlmClient,
  cfg: CompactionConfig
): boolean {
  if (cfg.useHistorySnip) snipCompact(state);
  if (cfg.useContextCollapse) contextCollapse(state);
  return estimateTokens(state.messages) > client.contextWindow * cfg.thresholdRatio;
}

export function snipCompact(state: AgentState): void {
  const newMsgs: ChatMessage[] = [];
  const boundaries: number[] = [];

  for (let i = 0; i < state.messages.length; i++) {
    const m = state.messages[i];
    
    // Remove zombie assistants (no content, no tools)
    if (m.role === "assistant" && !m.content && (!m.toolCalls || m.toolCalls.length === 0)) {
      continue;
    }

    // Keep track of boundaries
    if (m.content === COMPACT_BOUNDARY_MARKER) {
      boundaries.push(newMsgs.length);
    }

    newMsgs.push(m);
  }

  // Remove orphaned tool messages
  const withoutOrphans: ChatMessage[] = [];
  for (const m of newMsgs) {
    if (m.role === "tool") {
      // Find matching assistant call
      const hasCall = withoutOrphans.some(
        (prev) => prev.role === "assistant" && prev.toolCalls?.some((tc) => tc.id === m.toolCallId)
      );
      if (!hasCall) continue;
    }
    withoutOrphans.push(m);
  }

  // Ensure at most 1 boundary (the latest)
  if (boundaries.length > 1) {
    const latest = boundaries[boundaries.length - 1];
    state.messages = withoutOrphans.filter((m, idx) => m.content !== COMPACT_BOUNDARY_MARKER || idx === latest);
  } else {
    state.messages = withoutOrphans;
  }
}

export function contextCollapse(state: AgentState): void {
  if (state.messages.length === 0) return;
  const collapsed: ChatMessage[] = [state.messages[0]];
  for (let i = 1; i < state.messages.length; i++) {
    const prev = collapsed[collapsed.length - 1];
    const curr = state.messages[i];

    if (prev.role === "user" && curr.role === "user") {
      prev.content = `${prev.content}\n\n${curr.content}`;
    } else if (
      prev.role === "assistant" &&
      curr.role === "assistant" &&
      (!prev.toolCalls || prev.toolCalls.length === 0) &&
      (!curr.toolCalls || curr.toolCalls.length === 0)
    ) {
      prev.content = `${prev.content}\n\n${curr.content}`;
    } else {
      collapsed.push({ ...curr });
    }
  }
  state.messages = collapsed;
}

/**
 * Replace the message history with:
 *   [system_prompt, original task (verbatim), compaction summary, ...last N messages verbatim]
 * The system prompt and original user task are never summarized.
 */
export async function compact(
  state: AgentState,
  client: LlmClient,
  cfg: CompactionConfig,
  opts?: { cwdForRepoSnapshot?: string; sessionLogger?: import("../sessions/logger.js").SessionLogger }
): Promise<void> {
  const history = state.messages;

  // Keep a verbatim tail, but never let it start with an orphaned tool result
  // (a "tool" message whose matching assistant tool-call was summarized away).
  let tailStart = Math.max(1, history.length - cfg.keepLastMessages);
  while (tailStart < history.length && history[tailStart].role === "tool") tailStart++;
  const tail = history.slice(tailStart);
  const maxTranscriptChars = Math.max(10000, Math.floor(client.contextWindow * 0.6 * 3.5));

  const transcript = history
    .slice(1, tailStart) // skip system prompt; tail is kept verbatim anyway
    .map((m) => {
      if (m.role === "assistant" && m.toolCalls?.length) {
        const calls = m.toolCalls.map((tc) => `${tc.name}(${JSON.stringify(tc.input)})`).join(", ");
        return `assistant: ${m.content ?? ""} [tool calls: ${calls}]`;
      }
      if (m.role === "tool") {
        const text = String(m.content ?? "");
        const shortText = text.length > 800 ? text.slice(0, 800) + "... [truncated]" : text;
        return `tool result: ${shortText}`;
      }
      return `${m.role}: ${m.content}`;
    })
    .join("\n---\n")
    .slice(-maxTranscriptChars);

  let response;
  try {
    response = await client.chat(
      [
        { role: "system", content: SUMMARIZE_INSTRUCTION },
        {
          role: "user",
          content: `Known world state (tracked separately, already reliable):\n${worldStateSummary(state.world)}\n\nRepo snapshot (best-effort):\n${await getRepoSnapshot(opts?.cwdForRepoSnapshot)}\n\nConversation to summarize:\n${transcript}`,
        },
      ],
      [] // no tools for the summarization call
    );
  } catch (err) {
    // If summarization call still fails (e.g. provider context limit), fallback to world state summary
    response = {
      text: JSON.stringify({
        objective: state.world.memory.objective || "Continue task",
        summary: `Prior context compacted. World state: ${worldStateSummary(state.world)}`,
        decisions: state.world.memory.decisions,
        open_questions: state.world.memory.openQuestions,
        next_steps: state.world.memory.nextSteps,
      }),
      toolCalls: [],
    };
  }
  const raw = response.text ?? "";
  const parsed = parseCompactionJson(raw);
  const summary = parsed?.summary || raw || "(summarization returned no text)";

  if (parsed) {
    state.world.memory.objective = parsed.objective ?? state.world.memory.objective;
    // Merge decisions: keep existing ledger entries and append new ones from the summary
    if (Array.isArray(parsed.decisions)) {
      const existing = new Set(state.world.memory.decisions);
      for (const d of parsed.decisions) {
        if (typeof d === "string" && d.trim() && !existing.has(d.trim())) {
          state.world.memory.decisions.push(d.trim());
          existing.add(d.trim());
        }
      }
    }
    state.world.memory.openQuestions = parsed.open_questions ?? state.world.memory.openQuestions;
    state.world.memory.nextSteps = parsed.next_steps ?? state.world.memory.nextSteps;
    state.world.memory.lastCompactedAt = new Date().toISOString();
  } else {
    // Keep the raw summary as a note if it wasn't valid JSON.
    // Decisions ledger is preserved regardless since it lives in state.world.memory.
    state.world.notes.push(`Compaction summary (raw): ${summary.slice(0, 5000)}`);
    state.world.memory.lastCompactedAt = new Date().toISOString();
  }

  const rebuilt: ChatMessage[] = [{ role: "system", content: state.systemPrompt }];
  
  // Cap the decisions ledger to the most recent 50 entries to avoid unbounded growth
  if (state.world.memory.decisions.length > 50) {
    state.world.memory.decisions = state.world.memory.decisions.slice(-50);
  }

  let summaryContent = `[Context was compacted. Summary of the conversation so far:]\n${summary}\n\n[World state:]\n${worldStateSummary(state.world)}`;
  if (state.originalTask) {
    summaryContent = `Original task (verbatim):\n${state.originalTask}\n\n` + summaryContent;
  }
  
  rebuilt.push({ role: "user", content: summaryContent });
  rebuilt.push({ role: "assistant", content: COMPACT_BOUNDARY_MARKER });
  if (opts?.sessionLogger) {
    opts.sessionLogger.logAsync({ type: "system", subtype: "compact_boundary", summary });
  }
  rebuilt.push(...tail);

  state.messages = rebuilt;
}

async function getRepoSnapshot(cwd?: string): Promise<string> {
  if (!cwd) return "(no cwd provided)";
  try {
    const branch = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, windowsHide: true, reject: false });
    if (branch.exitCode !== 0) return "(not a git repo)";
    const status = await execa("git", ["status", "-sb", "--porcelain=v1"], {
      cwd,
      windowsHide: true,
      reject: false,
      maxBuffer: 2 * 1024 * 1024,
    });
    const diffStat = await execa("git", ["diff", "--stat"], {
      cwd,
      windowsHide: true,
      reject: false,
      maxBuffer: 2 * 1024 * 1024,
    });
    const out = [
      `branch: ${branch.stdout.trim()}`,
      `status:\n${(status.stdout || "(clean)").trim()}`,
      `diff --stat:\n${(diffStat.stdout || "(no diff)").trim()}`,
    ].join("\n");
    return out.slice(0, 8000);
  } catch (err) {
    return `Error getting repo snapshot: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function parseCompactionJson(text: string): any | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = raw.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}
