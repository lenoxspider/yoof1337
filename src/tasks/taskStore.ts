import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "stopped";

export interface Task {
  id: string;
  prompt: string;
  status: TaskStatus;
  assignee: string;
  output: string;
  result: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  dependencies: string[];
}

export interface TaskCreateInput {
  prompt: string;
  assignee?: string;
  metadata?: Record<string, unknown>;
  dependencies?: string[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Store
// ──────────────────────────────────────────────────────────────────────────────

export class TaskStore extends EventEmitter {
  private tasks: Map<string, Task> = new Map();
  private savePath: string | null = null;
  private saveTimeout: NodeJS.Timeout | null = null;

  init(sandboxRoot: string) {
    this.savePath = path.join(sandboxRoot, ".yoof1337-tasks.json");
    if (fs.existsSync(this.savePath)) {
      try {
        const raw = fs.readFileSync(this.savePath, "utf-8");
        const parsed = JSON.parse(raw) as Task[];
        for (const t of parsed) {
          this.tasks.set(t.id, t);
        }
      } catch (err) {
        console.error("Failed to load tasks from disk:", err);
      }
    }
  }

  private triggerSave() {
    if (!this.savePath) return;
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      try {
        fs.writeFileSync(this.savePath!, JSON.stringify(Array.from(this.tasks.values()), null, 2));
      } catch (err) {
        // Ignore
      }
    }, 1000); // Debounce 1s
  }

  create(input: TaskCreateInput): Task {
    const id = crypto.randomBytes(6).toString("hex");
    const now = new Date().toISOString();
    const task: Task = {
      id,
      prompt: input.prompt,
      status: "pending",
      assignee: input.assignee ?? "default",
      output: "",
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata ?? {},
      dependencies: input.dependencies ?? [],
    };
    this.tasks.set(id, task);
    this.triggerSave();
    this.emit("task:created", task);
    return task;
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  list(filter?: { status?: TaskStatus; assignee?: string }): Task[] {
    let results = Array.from(this.tasks.values());
    if (filter?.status) results = results.filter(t => t.status === filter.status);
    if (filter?.assignee) results = results.filter(t => t.assignee === filter.assignee);
    return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  update(id: string, updates: Partial<Pick<Task, "status" | "output" | "result" | "error" | "metadata" | "assignee">>): Task | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    
    if (updates.status !== undefined) {
      task.status = updates.status;
      if (task.status === "failed") {
        this.cascadeFailure(id);
      }
    }
    if (updates.output !== undefined) task.output = updates.output;
    if (updates.result !== undefined) task.result = updates.result;
    if (updates.error !== undefined) task.error = updates.error;
    if (updates.metadata !== undefined) task.metadata = { ...task.metadata, ...updates.metadata };
    if (updates.assignee !== undefined) task.assignee = updates.assignee;
    
    task.updatedAt = new Date().toISOString();
    this.triggerSave();
    this.emit("task:updated", task);
    return task;
  }

  appendOutput(id: string, chunk: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.output += chunk;
    task.updatedAt = new Date().toISOString();
    this.triggerSave();
  }

  stop(id: string): Task | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    if (task.status === "completed" || task.status === "failed" || task.status === "stopped") {
      return task;
    }
    task.status = "stopped";
    task.updatedAt = new Date().toISOString();
    this.triggerSave();
    this.emit("task:stopped", task);
    return task;
  }

  getOutput(id: string): string | undefined {
    return this.tasks.get(id)?.output;
  }

  private cascadeFailure(failedTaskId: string) {
    for (const t of this.tasks.values()) {
      if (t.status === "pending" && t.dependencies.includes(failedTaskId)) {
        t.status = "failed";
        t.error = `Dependency task ${failedTaskId} failed`;
        t.updatedAt = new Date().toISOString();
        this.triggerSave();
        this.emit("task:updated", t);
        // Recursively cascade
        this.cascadeFailure(t.id);
      }
    }
  }
}

// Global singleton
export const taskStore = new TaskStore();
