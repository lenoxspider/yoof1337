import { taskStore } from "./taskStore.js";
import { spawnWorker, stopWorker, type SpawnMode } from "./agentWorker.js";
import type { SandboxContext } from "../tools/sandbox.js";

// ──────────────────────────────────────────────────────────────────────────────
// Team — a named group of agents with a shared purpose and system prompt
// ──────────────────────────────────────────────────────────────────────────────

export interface Team {
  name: string;
  systemPrompt: string;
  provider?: string;
  createdAt: string;
  activeTasks: string[];
}

const teams = new Map<string, Team>();

export function createTeam(name: string, systemPrompt: string, provider?: string): Team {
  if (teams.has(name)) {
    throw new Error(`Team "${name}" already exists.`);
  }
  const team: Team = {
    name,
    systemPrompt,
    provider,
    createdAt: new Date().toISOString(),
    activeTasks: [],
  };
  teams.set(name, team);
  return team;
}

export function deleteTeam(name: string): boolean {
  const team = teams.get(name);
  if (!team) return false;
  // Stop all active tasks for this team
  for (const taskId of team.activeTasks) {
    stopWorker(taskId);
  }
  teams.delete(name);
  return true;
}

export function getTeam(name: string): Team | undefined {
  return teams.get(name);
}

export function listTeams(): Team[] {
  return Array.from(teams.values());
}

/**
 * Assign a task to a team: creates a task, then spawns a worker using the
 * team's system prompt and provider.
 */
export function assignTaskToTeam(
  teamName: string,
  prompt: string,
  sandbox: SandboxContext,
  mode?: SpawnMode,
  dependencies?: string[]
): string {
  const team = teams.get(teamName);
  if (!team) throw new Error(`Team "${teamName}" does not exist.`);

  const task = taskStore.create({
    prompt,
    assignee: teamName,
    dependencies,
  });

  team.activeTasks.push(task.id);

  spawnWorker(task.id, {
    systemPrompt: team.systemPrompt,
    provider: team.provider,
    sandbox,
    mode,
  });

  // Clean completed tasks from the active list
  taskStore.on("task:updated", (updated) => {
    if (updated.id === task.id && (updated.status === "completed" || updated.status === "failed" || updated.status === "stopped")) {
      team.activeTasks = team.activeTasks.filter(id => id !== task.id);
    }
  });

  return task.id;
}

// ──────────────────────────────────────────────────────────────────────────────
// Inter-Agent Messaging (simple pub/sub on task output)
// ──────────────────────────────────────────────────────────────────────────────

export interface AgentMessage {
  from: string;
  to: string;
  content: string;
  timestamp: string;
}

const messageInbox = new Map<string, AgentMessage[]>();

export function sendMessage(from: string, to: string, content: string): void {
  const msg: AgentMessage = {
    from,
    to,
    content,
    timestamp: new Date().toISOString(),
  };
  if (!messageInbox.has(to)) messageInbox.set(to, []);
  messageInbox.get(to)!.push(msg);
}

export function getMessages(agentId: string): AgentMessage[] {
  return messageInbox.get(agentId) ?? [];
}

export function clearMessages(agentId: string): void {
  messageInbox.delete(agentId);
}
