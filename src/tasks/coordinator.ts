import { taskStore, type Task } from "./taskStore.js";
import { listTeams } from "./teamManager.js";
import { createClient } from "../llm/factory.js";
import { loadConfig } from "../config.js";
import { spawnWorker } from "./agentWorker.js";
import type { SandboxContext } from "../tools/sandbox.js";

let sandboxCtx: SandboxContext | null = null;
let coordinatorRunning = false;

export function initCoordinator(sandbox: SandboxContext) {
  if (coordinatorRunning) return;
  coordinatorRunning = true;
  sandboxCtx = sandbox;

  taskStore.on("task:created", async (task: Task) => {
    if (task.assignee === "unassigned") {
      await autoAssignTask(task);
    }
  });
}

async function autoAssignTask(task: Task) {
  const teams = listTeams();
  if (teams.length === 0) {
    taskStore.update(task.id, {
      status: "failed",
      error: "No teams available to claim this unassigned task. Lead Agent must handle manually."
    });
    return;
  }

  const teamsStr = teams.map(t => `- ${t.name}: ${t.systemPrompt.slice(0, 150)}...`).join("\n");
  const prompt = `You are an Autonomous Coordinator.
A new task has been added to the job board. Your job is to select the most appropriate team to claim it.

AVAILABLE TEAMS:
${teamsStr}

TASK PROMPT:
${task.prompt}

Return strictly the exact name of the team that should claim this task. If NO team is a good fit, return exactly: NONE`;

  try {
    const config = loadConfig();
    const client = createClient(config);
    const response = await client.chat([{ role: "user", content: prompt }], []);
    const result = (response.text || "NONE").trim();

    if (result === "NONE" || !teams.find(t => t.name === result)) {
      taskStore.update(task.id, {
        status: "failed",
        error: "No suitable team found for this task. Lead Agent must handle manually."
      });
      return;
    }

    // Assign to the selected team
    const selectedTeam = teams.find(t => t.name === result)!;
    taskStore.update(task.id, { assignee: selectedTeam.name });
    
    // Track in teamManager if needed, but since activeTasks is local to teamManager,
    // we should just spawn the worker directly with the team's systemPrompt.
    if (sandboxCtx) {
      spawnWorker(task.id, {
        systemPrompt: selectedTeam.systemPrompt,
        provider: selectedTeam.provider,
        sandbox: sandboxCtx,
        // metadata might have mode inside it, let's assume default for unassigned auto-spawn
        mode: (task.metadata as any)?.mode || "default"
      });
    }
  } catch (err) {
    taskStore.update(task.id, {
      status: "failed",
      error: `Coordinator failed to assign task: ${err instanceof Error ? err.message : String(err)}`
    });
  }
}
