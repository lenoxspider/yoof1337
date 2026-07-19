import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { AgentState } from "../loop/state.js";

export type SessionMeta = {
  type?: "meta";
  id: string;
  createdAt: string;
  updatedAt: string;
  provider: string;
  model: string;
  sandboxRoot: string;
  title: string;
};

export type StoredSession = {
  meta: SessionMeta;
  state: {
    systemPrompt: string;
    originalTask: string | null;
    messages: AgentState["messages"];
    world: {
      filesTouched: string[];
      commandsRun: string[];
      notes: string[];
      memory: AgentState["world"]["memory"];
      permissions: AgentState["world"]["permissions"];
    };
  };
};

export function defaultSessionsDir(): string {
  // Keep it user-local and out of the repo by default.
  const base =
    process.platform === "win32"
      ? process.env.LOCALAPPDATA ?? os.tmpdir()
      : process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state");
  return path.join(base, "yoof1337", "sessions");
}

export async function ensureSessionsDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export function newSessionId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export async function listSessions(dir: string, sandboxRoot?: string): Promise<SessionMeta[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let metas: SessionMeta[] = [];
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
      try {
        const file = path.join(dir, e.name);
        const fh = await fs.open(file, "r");
        const buf = Buffer.alloc(4096);
        const { bytesRead } = await fh.read(buf, 0, 4096, 0);
        await fh.close();
        if (bytesRead > 0) {
          const firstLine = buf.toString("utf8").split("\n")[0];
          const parsed = JSON.parse(firstLine);
          if (parsed && parsed.type === "meta" && parsed.id) {
            metas.push(parsed as SessionMeta);
          }
        }
      } catch {
        // ignore
      }
    }
    if (sandboxRoot) {
      metas = metas.filter((m) => m.sandboxRoot === sandboxRoot);
    }
    metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return metas;
  } catch {
    return [];
  }
}

export async function getLastSessionId(dir: string, sandboxRoot?: string): Promise<string | null> {
  const sessions = await listSessions(dir, sandboxRoot);
  if (sessions.length === 0) return null;
  return sessions[0].id;
}

export async function loadSession(dir: string, id: string): Promise<StoredSession> {
  const file = path.join(dir, `${id}.jsonl`);
  const raw = await fs.readFile(file, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  
  if (lines.length === 0) throw new Error("Empty session file");
  
  const meta = JSON.parse(lines[0]) as SessionMeta;
  if (meta.type !== "meta") throw new Error("Invalid session file: first line is not meta");

  const state: AgentState = {
    systemPrompt: "",
    originalTask: null,
    messages: [],
    world: {
      filesTouched: new Set(),
      commandsRun: [],
      bgCommandsRun: [],
      notes: [],
      memory: {
        objective: "",
        decisions: [],
        openQuestions: [],
        nextSteps: [],
        repoSnapshot: "",
        lastCompactedAt: "",
      },
      permissions: { allowCommandPrefixes: [] },
    },
  };

  for (let i = 1; i < lines.length; i++) {
    try {
      const event = JSON.parse(lines[i]);
      if (event.type === "user") {
        if (event.originalTask && !state.originalTask) {
          state.originalTask = event.originalTask;
        }
        state.messages.push({ role: "user", content: event.content });
      } else if (event.type === "assistant") {
        state.messages.push({ role: "assistant", content: event.content, toolCalls: event.toolCalls });
      } else if (event.type === "tool") {
        state.messages.push({ role: "tool", toolCallId: event.toolCallId, content: event.content });
      } else if (event.type === "progress" && event.world) {
        state.world = event.world;
        if (Array.isArray(state.world.filesTouched)) {
           state.world.filesTouched = new Set(state.world.filesTouched);
        }
      } else if (event.type === "system" && event.subtype === "compact_boundary") {
        state.messages.push({ role: "assistant", content: "[compact_boundary]" });
      }
    } catch {
      // ignore invalid lines
    }
  }

  // Find system prompt from the first meta event or if missing, it's injected later
  state.systemPrompt = "System prompt will be restored on resume";
  
  return {
    meta,
    state: {
      systemPrompt: state.systemPrompt,
      originalTask: state.originalTask,
      messages: state.messages,
      world: {
        filesTouched: [...state.world.filesTouched],
        commandsRun: state.world.commandsRun,
        notes: state.world.notes,
        memory: state.world.memory,
        permissions: state.world.permissions,
      },
    },
  };
}

export function toStoredSession(
  state: AgentState,
  meta: Omit<SessionMeta, "createdAt" | "updatedAt" | "title"> & { createdAt?: string; title?: string }
): StoredSession {
  const now = new Date().toISOString();
  const createdAt = meta.createdAt ?? now;
  const title =
    meta.title ??
    (state.originalTask ? state.originalTask.slice(0, 80).replace(/\s+/g, " ").trim() : "untitled");
  return {
    meta: {
      id: meta.id,
      createdAt,
      updatedAt: now,
      provider: meta.provider,
      model: meta.model,
      sandboxRoot: meta.sandboxRoot,
      title,
    },
    state: {
      systemPrompt: state.systemPrompt,
      originalTask: state.originalTask,
      messages: state.messages,
      world: {
        filesTouched: [...state.world.filesTouched],
        commandsRun: [...state.world.commandsRun],
        notes: [...state.world.notes],
        memory: state.world.memory,
        permissions: state.world.permissions,
      },
    },
  };
}

export function applyStoredSession(state: AgentState, stored: StoredSession): void {
  // We keep the current newly generated system prompt instead of the old one
  state.originalTask = stored.state.originalTask;
  state.messages = stored.state.messages;
  state.world.filesTouched = new Set(stored.state.world.filesTouched);
  state.world.commandsRun = stored.state.world.commandsRun;
  state.world.notes = stored.state.world.notes;
  state.world.memory = stored.state.world.memory ?? state.world.memory;
  state.world.permissions = stored.state.world.permissions ?? state.world.permissions;
}
