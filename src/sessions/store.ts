import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { AgentState } from "../loop/state.js";

export type SessionMeta = {
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

export async function saveSession(dir: string, session: StoredSession): Promise<string> {
  await ensureSessionsDir(dir);
  const file = path.join(dir, `${session.meta.id}.json`);
  await fs.writeFile(file, JSON.stringify(session, null, 2), "utf8");
  return file;
}

export async function loadSession(dir: string, id: string): Promise<StoredSession> {
  const file = path.join(dir, `${id}.json`);
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw) as StoredSession;
}

export async function listSessions(dir: string): Promise<SessionMeta[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const metas: SessionMeta[] = [];
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(dir, e.name), "utf8");
        const parsed = JSON.parse(raw) as StoredSession;
        if (parsed?.meta?.id) metas.push(parsed.meta);
      } catch {
        // ignore
      }
    }
    metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return metas;
  } catch {
    return [];
  }
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
      },
    },
  };
}

export function applyStoredSession(state: AgentState, stored: StoredSession): void {
  state.systemPrompt = stored.state.systemPrompt;
  state.originalTask = stored.state.originalTask;
  state.messages = stored.state.messages;
  state.world.filesTouched = new Set(stored.state.world.filesTouched);
  state.world.commandsRun = stored.state.world.commandsRun;
  state.world.notes = stored.state.world.notes;
  state.world.memory = stored.state.world.memory ?? state.world.memory;
}
