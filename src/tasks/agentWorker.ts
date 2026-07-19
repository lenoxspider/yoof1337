import { createAgentState } from "../loop/state.js";
import { runTurn } from "../loop/agentLoop.js";
import { loadConfig } from "../config.js";
import { createClient } from "../llm/factory.js";
import { taskStore, type Task } from "./taskStore.js";
import type { SandboxContext } from "../tools/sandbox.js";
import type { LoopIO } from "../loop/agentLoop.js";

import { fork, ChildProcess } from "child_process";
import { getWorkspaceManager } from "./workspaceManager.js";
import { fileURLToPath } from "url";
import path from "path";

// ──────────────────────────────────────────────────────────────────────────────
// Agent Worker — runs a headless agent loop for a task
// ──────────────────────────────────────────────────────────────────────────────

export type SpawnMode = "default" | "fork" | "worktree";

export interface AgentWorkerOptions {
  systemPrompt?: string;
  provider?: string;
  configPath?: string;
  sandbox: SandboxContext;
  maxIterations?: number;
  mode?: SpawnMode;
}

const DEFAULT_SUB_AGENT_PROMPT = `You are a sub-agent working inside yoof1337, a terminal-based coding agent.
You have been spawned by the lead agent to complete a specific task.
You have the same tools available as the lead agent: read/write files, run commands, search code, etc.
Focus exclusively on completing the task you were given. When done, provide a concise summary of what you did.`;

export class AgentWorker {
  private abortController = new AbortController();
  private running = false;
  private child: ChildProcess | null = null;

  constructor(
    private taskId: string,
    private options: AgentWorkerOptions
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  async run(): Promise<void> {
    const task = taskStore.get(this.taskId);
    if (!task) throw new Error(`Task ${this.taskId} not found`);

    this.running = true;
    taskStore.update(this.taskId, { status: "running" });

    const mode = this.options.mode || "default";

    if (mode === "default") {
      await this.runInProcess(task);
    } else {
      await this.runInFork(task, mode);
    }
  }

  private async runInProcess(task: Task): Promise<void> {
    try {
      const config = loadConfig(this.options.configPath);
      if (this.options.maxIterations) {
        config.maxToolIterationsPerTurn = this.options.maxIterations;
      }
      const provider = this.options.provider || config.provider;
      const client = createClient(config, provider);

      const sysPrompt = this.options.systemPrompt || DEFAULT_SUB_AGENT_PROMPT;
      const state = createAgentState(sysPrompt);

      const io: LoopIO = {
        print: (text: string) => {
          taskStore.appendOutput(this.taskId, text + "\n");
        },
        abortSignal: this.abortController.signal,
      };

      const permissions = { yolo: true, allowCommandPrefixes: [] as string[] };

      await runTurn(state, task.prompt, client, config, this.options.sandbox, permissions, io);

      // Extract the final assistant message as the result
      const finalMsg = [...state.messages].reverse().find(m => m.role === "assistant" && m.content);
      const result = finalMsg?.content ?? "(no output)";

      taskStore.update(this.taskId, {
        status: "completed",
        result: typeof result === "string" ? result : "(no output)",
      });
    } catch (err: any) {
      if (!this.abortController.signal.aborted) {
        taskStore.update(this.taskId, {
          status: "failed",
          error: err.message,
        });
      }
    } finally {
      this.running = false;
    }
  }

  private async runInFork(task: Task, mode: "fork" | "worktree"): Promise<void> {
    return new Promise((resolve, reject) => {
      let sandboxRoot = this.options.sandbox.root;
      const sysPrompt = this.options.systemPrompt || DEFAULT_SUB_AGENT_PROMPT;

      if (mode === "worktree") {
        try {
          const wm = getWorkspaceManager(sandboxRoot);
          sandboxRoot = wm.createWorktree(this.taskId, sandboxRoot);
          taskStore.appendOutput(this.taskId, `[System] Created git worktree at ${sandboxRoot}\n`);
        } catch (err: any) {
          taskStore.update(this.taskId, { status: "failed", error: err.message });
          this.running = false;
          resolve();
          return;
        }
      }

      // Determine path to workerProcess.js
      const dirname = path.dirname(fileURLToPath(import.meta.url));
      const workerPath = path.join(dirname, "workerProcess.js");

      this.child = fork(workerPath, [], {
        env: {
          ...process.env,
          YOOF_TASK_ID: this.taskId,
          YOOF_TASK_PROMPT: task.prompt,
          YOOF_PROVIDER: this.options.provider || "",
          YOOF_SANDBOX_ROOT: sandboxRoot,
          YOOF_SYSTEM_PROMPT: sysPrompt,
          YOOF_MAX_ITERATIONS: String(this.options.maxIterations ?? 50),
        },
      });

      this.child.on("message", (msg: any) => {
        if (!msg || typeof msg !== "object") return;
        switch (msg.type) {
          case "log":
          case "warn":
            taskStore.appendOutput(this.taskId, msg.msg);
            break;
          case "status":
            taskStore.update(this.taskId, { status: msg.status });
            break;
          case "completed":
            taskStore.update(this.taskId, { status: "completed", result: typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result) });
            break;
          case "failed":
            taskStore.update(this.taskId, { status: "failed", error: msg.error });
            break;
        }
      });

      this.child.on("exit", () => {
        this.running = false;
        resolve();
      });

      this.abortController.signal.addEventListener("abort", () => {
        if (this.child) {
          this.child.kill("SIGTERM");
        }
      });
    });
  }

  stop(): void {
    this.abortController.abort();
    taskStore.stop(this.taskId);
    if (this.child) {
      this.child.kill("SIGTERM");
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Worker Registry — tracks active workers so they can be stopped
// ──────────────────────────────────────────────────────────────────────────────

const workers = new Map<string, AgentWorker>();

export function spawnWorker(taskId: string, options: AgentWorkerOptions): AgentWorker | null {
  const task = taskStore.get(taskId);
  if (!task) return null;

  const worker = new AgentWorker(taskId, options);

  const checkAndRun = () => {
    // If stopped/failed before even running, just cleanup
    if (task.status === "failed" || task.status === "stopped") {
      taskStore.off("task:updated", listener);
      return;
    }
    
    // Check dependencies
    const isReady = (task.dependencies ?? []).every(id => {
      const d = taskStore.get(id);
      return d && d.status === "completed";
    });

    if (isReady) {
      taskStore.off("task:updated", listener);
      workers.set(taskId, worker);
      worker.run().finally(() => {
        workers.delete(taskId);
      });
    }
  };

  const listener = (updatedTask: any) => {
    if ((task.dependencies ?? []).includes(updatedTask.id)) {
      checkAndRun();
    }
  };

  taskStore.on("task:updated", listener);
  checkAndRun(); // Check immediately

  return worker;
}

export function getWorker(taskId: string): AgentWorker | undefined {
  return workers.get(taskId);
}

export function stopWorker(taskId: string): boolean {
  const worker = workers.get(taskId);
  if (!worker) return false;
  worker.stop();
  workers.delete(taskId);
  return true;
}

export function listWorkers(): string[] {
  return Array.from(workers.keys());
}
