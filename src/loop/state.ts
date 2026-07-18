import type { ChatMessage } from "../llm/client.js";

/**
 * Lightweight "state of the world" tracker kept OUTSIDE the raw message log,
 * so compaction is never the only source of truth for what has happened.
 */
export interface WorldState {
  /** Files created or overwritten via write_file. */
  filesTouched: Set<string>;
  /** Commands executed via run_command. */
  commandsRun: string[];
  /** Key decisions/notes worth preserving across compactions. */
  notes: string[];
  /** Structured memory that survives compaction. */
  memory: {
    objective: string;
    decisions: string[];
    openQuestions: string[];
    nextSteps: string[];
    repoSnapshot: string;
    lastCompactedAt: string;
  };
}

export interface AgentState {
  systemPrompt: string;
  /** The original user task -- always kept verbatim, never summarized away. */
  originalTask: string | null;
  messages: ChatMessage[];
  world: WorldState;
  sessionId?: string;
}

export function createAgentState(systemPrompt: string): AgentState {
  return {
    systemPrompt,
    originalTask: null,
    messages: [{ role: "system", content: systemPrompt }],
    world: {
      filesTouched: new Set(),
      commandsRun: [],
      notes: [],
      memory: {
        objective: "",
        decisions: [],
        openQuestions: [],
        nextSteps: [],
        repoSnapshot: "",
        lastCompactedAt: "",
      },
    },
  };
}

export function worldStateSummary(world: WorldState): string {
  const parts: string[] = [];
  if (world.memory.objective) parts.push(`Objective:\n- ${world.memory.objective}`);
  if (world.memory.decisions.length > 0) {
    parts.push(`Decisions:\n${world.memory.decisions.map((d) => `- ${d}`).join("\n")}`);
  }
  if (world.memory.openQuestions.length > 0) {
    parts.push(`Open questions:\n${world.memory.openQuestions.map((q) => `- ${q}`).join("\n")}`);
  }
  if (world.memory.nextSteps.length > 0) {
    parts.push(`Next steps:\n${world.memory.nextSteps.map((s) => `- ${s}`).join("\n")}`);
  }
  if (world.memory.repoSnapshot) parts.push(`Repo snapshot:\n${world.memory.repoSnapshot}`);
  if (world.memory.lastCompactedAt) parts.push(`Last compacted:\n- ${world.memory.lastCompactedAt}`);
  if (world.filesTouched.size > 0) {
    parts.push(`Files touched:\n${[...world.filesTouched].map((f) => `- ${f}`).join("\n")}`);
  }
  if (world.commandsRun.length > 0) {
    parts.push(`Commands run:\n${world.commandsRun.map((c) => `- ${c}`).join("\n")}`);
  }
  if (world.notes.length > 0) {
    parts.push(`Notes:\n${world.notes.map((n) => `- ${n}`).join("\n")}`);
  }
  return parts.length > 0 ? parts.join("\n\n") : "(nothing tracked yet)";
}
