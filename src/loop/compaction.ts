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

export function shouldCompact(
  messages: ChatMessage[],
  client: LlmClient,
  cfg: CompactionConfig
): boolean {
  return estimateTokens(messages) > client.contextWindow * cfg.thresholdRatio;
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
  opts?: { cwdForRepoSnapshot?: string }
): Promise<void> {
  const history = state.messages;

  // Keep a verbatim tail, but never let it start with an orphaned tool result
  // (a "tool" message whose matching assistant tool-call was summarized away).
  let tailStart = Math.max(1, history.length - cfg.keepLastMessages);
  while (tailStart < history.length && history[tailStart].role === "tool") tailStart++;
  const tail = history.slice(tailStart);

  const transcript = history
    .slice(1, tailStart) // skip system prompt; tail is kept verbatim anyway
    .map((m) => {
      if (m.role === "assistant" && m.toolCalls?.length) {
        const calls = m.toolCalls.map((tc) => `${tc.name}(${JSON.stringify(tc.input)})`).join(", ");
        return `assistant: ${m.content ?? ""} [tool calls: ${calls}]`;
      }
      if (m.role === "tool") return `tool result: ${m.content}`;
      return `${m.role}: ${m.content}`;
    })
    .join("\n---\n");

  const response = await client.chat(
    [
      { role: "system", content: SUMMARIZE_INSTRUCTION },
      {
        role: "user",
        content: `Known world state (tracked separately, already reliable):\n${worldStateSummary(state.world)}\n\nRepo snapshot (best-effort):\n${await getRepoSnapshot(opts?.cwdForRepoSnapshot)}\n\nConversation to summarize:\n${transcript}`,
      },
    ],
    [] // no tools for the summarization call
  );
  const raw = response.text ?? "";
  const parsed = parseCompactionJson(raw);
  const summary = parsed?.summary || raw || "(summarization returned no text)";

  if (parsed) {
    state.world.memory.objective = parsed.objective ?? state.world.memory.objective;
    state.world.memory.decisions = parsed.decisions ?? state.world.memory.decisions;
    state.world.memory.openQuestions = parsed.open_questions ?? state.world.memory.openQuestions;
    state.world.memory.nextSteps = parsed.next_steps ?? state.world.memory.nextSteps;
    state.world.memory.lastCompactedAt = new Date().toISOString();
  } else {
    // Keep the raw summary as a note if it wasn't valid JSON.
    state.world.notes.push(`Compaction summary (raw): ${summary.slice(0, 5000)}`);
    state.world.memory.lastCompactedAt = new Date().toISOString();
  }

  const rebuilt: ChatMessage[] = [{ role: "system", content: state.systemPrompt }];
  if (state.originalTask) {
    rebuilt.push({ role: "user", content: `Original task (verbatim):\n${state.originalTask}` });
    rebuilt.push({ role: "assistant", content: "Understood. Continuing with this task." });
  }
  rebuilt.push({
    role: "user",
    content: `[Context was compacted. Summary of the conversation so far:]\n${summary}\n\n[World state:]\n${worldStateSummary(state.world)}`,
  });
  rebuilt.push({ role: "assistant", content: "Noted. I have the summarized context and will continue." });
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
