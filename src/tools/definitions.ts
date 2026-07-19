import type { ToolDefinition } from "../llm/client.js";
import type { SandboxContext } from "./sandbox.js";
import { SandboxViolationError } from "./sandbox.js";
import { readFile } from "./readFile.js";
import { writeFile } from "./writeFile.js";
import { listDirectory } from "./listDirectory.js";
import { runCommand } from "./runCommand.js";
import { searchCode } from "./searchCode.js";
import { readFileExcerpt } from "./readFileExcerpt.js";
import { editFile } from "./editFile.js";
import { globFiles } from "./globFiles.js";
import { applyPatch } from "./applyPatch.js";
import { editNotebook } from "./notebookEdit.js";
import { searchTools } from "./searchTools.js";
import { gitStatus } from "./gitStatus.js";
import { gitDiff } from "./gitDiff.js";
import { gitCommit } from "./gitCommit.js";
import { gitAdd } from "./gitAdd.js";
import { gitCheckout } from "./gitCheckout.js";
import { gitLog } from "./gitLog.js";
import {
  ghAuthStatus,
  ghIssueView,
  ghPrDiff,
  ghPrView,
  ghPrCreate,
  ghPrComment,
  ghPrCheckout,
  ghRepoView,
} from "./gh.js";
import { runCommandBg } from "./runCommandBg.js";
import { checkCommand } from "./checkCommand.js";
import { killCommand } from "./killCommand.js";

type Executor = (input: Record<string, unknown>, ctx: SandboxContext) => Promise<string>;

export interface RegisteredTool {
  definition: ToolDefinition;
  execute: Executor;
  /** Mutating tools require user confirmation (unless yolo mode). */
  mutating: boolean;
}

export const TOOLS: Record<string, RegisteredTool> = {
  read_file: {
    mutating: false,
    definition: {
      name: "read_file",
      description: "Read and return the contents of a file, relative to the working directory.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "File path relative to the working directory" } },
        required: ["path"],
      },
    },
    execute: (input, ctx) => readFile(input as { path: string }, ctx),
  },
  read_file_excerpt: {
    mutating: false,
    definition: {
      name: "read_file_excerpt",
      description: "Read a line-numbered excerpt from a file (defaults to ~200 lines).",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to the working directory" },
          startLine: { type: "number", description: "1-based start line (default: 1)" },
          endLine: { type: "number", description: "1-based end line (default: start+200)" },
          maxBytes: { type: "number", description: "Max output bytes (default: 256KB, max 512KB)" },
        },
        required: ["path"],
      },
    },
    execute: (input, ctx) =>
      readFileExcerpt(input as { path: string; startLine?: number; endLine?: number; maxBytes?: number }, ctx),
  },
  write_file: {
    mutating: true,
    definition: {
      name: "write_file",
      description: "Create or overwrite a file with the given content. Parent directories are created as needed.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to the working directory" },
          content: { type: "string", description: "Full file content to write" },
        },
        required: ["path", "content"],
      },
    },
    execute: (input, ctx) => writeFile(input as { path: string; content: string }, ctx),
  },
  edit_file: {
    mutating: true,
    definition: {
      name: "edit_file",
      description:
        "Edit a file without overwriting the whole thing. Supports replace (with match count checks), append, and prepend.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to the working directory" },
          mode: { type: "string", enum: ["replace", "append", "prepend", "multi_replace"], description: "Edit mode" },
          find: { type: "string", description: "Exact substring to find (mode=replace)" },
          replace: { type: "string", description: "Replacement text (mode=replace)" },
          text: { type: "string", description: "Text to append/prepend (mode=append|prepend)" },
          expectedOccurrences: { type: "number", description: "If set, replacement must match exactly this many times (mode=replace)" },
          chunks: { 
            type: "array", 
            description: "List of replacement chunks (mode=multi_replace)",
            items: {
              type: "object",
              properties: {
                find: { type: "string" },
                replace: { type: "string" },
                expectedOccurrences: { type: "number" }
              },
              required: ["find", "replace"]
            }
          }
        },
        required: ["path", "mode"],
      },
    },
    execute: (input, ctx) =>
      editFile(
        input as any,
        ctx
      ),
  },
  edit_notebook: {
    mutating: true,
    definition: {
      name: "edit_notebook",
      description: "Edit a Jupyter Notebook (.ipynb) file cell-by-cell.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to .ipynb file" },
          mode: { type: "string", enum: ["replace_cell", "add_cell", "delete_cell", "clear_output"] },
          cellIndex: { type: "number", description: "Index of cell to edit/delete/insert at" },
          cellType: { type: "string", enum: ["code", "markdown"] },
          source: { type: "string", description: "Source content for the cell" }
        },
        required: ["path", "mode"]
      }
    },
    execute: (input, ctx) => editNotebook(input as any, ctx)
  },
  search_tools: {
    mutating: false,
    definition: {
      name: "search_tools",
      description: "Search for available tools by keyword in their name or description.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"]
      }
    },
    execute: (input, ctx) => searchTools(input as any, ctx)
  },
  list_directory: {
    mutating: false,
    definition: {
      name: "list_directory",
      description: "List files and folders in a directory. Defaults to the working directory root.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path relative to the working directory (default: .)" },
        },
      },
    },
    execute: (input, ctx) => listDirectory(input as { path?: string }, ctx),
  },
  run_command: {
    mutating: true,
    definition: {
      name: "run_command",
      description:
        "Execute a shell command in the working directory. Returns stdout, stderr, and exit code. Commands time out after the configured limit.",
      inputSchema: {
        type: "object",
        properties: { command: { type: "string", description: "The shell command to run" } },
        required: ["command"],
      },
    },
    execute: (input, ctx) => runCommand(input as { command: string }, ctx),
  },
  run_command_bg: {
    mutating: true,
    definition: {
      name: "run_command_bg",
      description:
        "Start a shell command in the background and return an id. Use check_command to poll for completion.",
      inputSchema: {
        type: "object",
        properties: { command: { type: "string", description: "The shell command to start" } },
        required: ["command"],
      },
    },
    execute: (input, ctx) => runCommandBg(input as { command: string }, ctx),
  },
  check_command: {
    mutating: false,
    definition: {
      name: "check_command",
      description: "Check status/stdout/stderr for a background command started by run_command_bg.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "Command id returned by run_command_bg" } },
        required: ["id"],
      },
    },
    execute: (input, ctx) => checkCommand(input as { id: string }, ctx),
  },
  kill_command: {
    mutating: true,
    definition: {
      name: "kill_command",
      description: "Kill a background command started by run_command_bg.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "Command id returned by run_command_bg" } },
        required: ["id"],
      },
    },
    execute: (input, ctx) => killCommand(input as { id: string }, ctx),
  },
  search_code: {
    mutating: false,
    definition: {
      name: "search_code",
      description:
        "Search file contents recursively (grep-like, case-insensitive regex or literal). Returns file:line: matched text.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Regex or literal text to search for" },
          path: { type: "string", description: "Subdirectory to search in (default: whole working directory)" },
        },
        required: ["query"],
      },
    },
    execute: (input, ctx) => searchCode(input as { query: string; path?: string }, ctx),
  },
  glob_files: {
    mutating: false,
    definition: {
      name: "glob_files",
      description: "List files matching a glob pattern (supports **, *, ?) and respects .gitignore.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern (e.g. **/*.ts)" },
          path: { type: "string", description: "Subdirectory to search in (default: .)" },
          includeDirs: { type: "boolean", description: "Include matching directories (default: false)" },
        },
        required: ["pattern"],
      },
    },
    execute: (input, ctx) => globFiles(input as { pattern: string; path?: string; includeDirs?: boolean }, ctx),
  },
  apply_patch: {
    mutating: true,
    definition: {
      name: "apply_patch",
      description: "Apply a unified diff patch to files in the working directory sandbox.",
      inputSchema: {
        type: "object",
        properties: { patch: { type: "string", description: "Unified diff text" } },
        required: ["patch"],
      },
    },
    execute: (input, ctx) => applyPatch(input as { patch: string }, ctx),
  },
  git_status: {
    mutating: false,
    definition: {
      name: "git_status",
      description: "Show git status (porcelain) for the sandbox working directory.",
      inputSchema: { type: "object", properties: {} },
    },
    execute: (input, ctx) => gitStatus(input, ctx),
  },
  git_diff: {
    mutating: false,
    definition: {
      name: "git_diff",
      description: "Show git diff for the sandbox working directory.",
      inputSchema: {
        type: "object",
        properties: {
          cached: { type: "boolean", description: "If true, diff staged changes (--cached)" },
          path: { type: "string", description: "Optional pathspec to diff" },
        },
      },
    },
    execute: (input, ctx) => gitDiff(input as { cached?: boolean; path?: string }, ctx),
  },
  git_commit: {
    mutating: true,
    definition: {
      name: "git_commit",
      description: "Create a git commit with the given message in the sandbox working directory.",
      inputSchema: {
        type: "object",
        properties: { message: { type: "string", description: "Commit message" } },
        required: ["message"],
      },
    },
    execute: (input, ctx) => gitCommit(input as { message: string }, ctx),
  },
  git_add: {
    mutating: true,
    definition: {
      name: "git_add",
      description: "Stage changes with git add. Defaults to -A if no paths are provided.",
      inputSchema: {
        type: "object",
        properties: {
          paths: { type: "array", items: { type: "string" }, description: "Paths to add (default: all)" },
        },
      },
    },
    execute: (input, ctx) => gitAdd(input as { paths?: string[] }, ctx),
  },
  git_checkout: {
    mutating: true,
    definition: {
      name: "git_checkout",
      description: "Checkout a branch/ref, optionally creating it (-b).",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Branch or ref to checkout" },
          create: { type: "boolean", description: "If true, create branch (-b)" },
        },
        required: ["ref"],
      },
    },
    execute: (input, ctx) => gitCheckout(input as { ref: string; create?: boolean }, ctx),
  },
  git_log: {
    mutating: false,
    definition: {
      name: "git_log",
      description: "Show recent git commits (oneline).",
      inputSchema: {
        type: "object",
        properties: { n: { type: "number", description: "Number of commits (max 50)" } },
      },
    },
    execute: (input, ctx) => gitLog(input as { n?: number }, ctx),
  },
  gh_auth_status: {
    mutating: false,
    definition: {
      name: "gh_auth_status",
      description: "Show GitHub CLI auth status for the current user.",
      inputSchema: { type: "object", properties: {} },
    },
    execute: (input, ctx) => ghAuthStatus(input, ctx),
  },
  gh_pr_view: {
    mutating: false,
    definition: {
      name: "gh_pr_view",
      description: "View a GitHub pull request via GitHub CLI (gh).",
      inputSchema: {
        type: "object",
        properties: { pr: { type: "string", description: "PR number, branch name, or URL" } },
        required: ["pr"],
      },
    },
    execute: (input, ctx) => ghPrView(input as { pr: string }, ctx),
  },
  gh_pr_diff: {
    mutating: false,
    definition: {
      name: "gh_pr_diff",
      description: "Show the diff for a GitHub pull request via GitHub CLI (gh).",
      inputSchema: {
        type: "object",
        properties: { pr: { type: "string", description: "PR number, branch name, or URL" } },
        required: ["pr"],
      },
    },
    execute: (input, ctx) => ghPrDiff(input as { pr: string }, ctx),
  },
  gh_issue_view: {
    mutating: false,
    definition: {
      name: "gh_issue_view",
      description: "View a GitHub issue via GitHub CLI (gh).",
      inputSchema: {
        type: "object",
        properties: { issue: { type: "string", description: "Issue number or URL" } },
        required: ["issue"],
      },
    },
    execute: (input, ctx) => ghIssueView(input as { issue: string }, ctx),
  },
  gh_repo_view: {
    mutating: false,
    definition: {
      name: "gh_repo_view",
      description: "Show information about the current GitHub repo via GitHub CLI (gh).",
      inputSchema: { type: "object", properties: {} },
    },
    execute: (input, ctx) => ghRepoView(input, ctx),
  },
  gh_pr_create: {
    mutating: true,
    definition: {
      name: "gh_pr_create",
      description: "Create a GitHub pull request via GitHub CLI (gh).",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "PR title" },
          body: { type: "string", description: "PR body (markdown)" },
          draft: { type: "boolean", description: "Create as draft" },
          base: { type: "string", description: "Base branch (optional)" },
          head: { type: "string", description: "Head branch (optional)" },
        },
        required: ["title"],
      },
    },
    execute: (input, ctx) =>
      ghPrCreate(input as { title: string; body?: string; draft?: boolean; base?: string; head?: string }, ctx),
  },
  gh_pr_comment: {
    mutating: true,
    definition: {
      name: "gh_pr_comment",
      description: "Post a comment to a GitHub pull request via GitHub CLI (gh).",
      inputSchema: {
        type: "object",
        properties: {
          pr: { type: "string", description: "PR number, branch name, or URL" },
          body: { type: "string", description: "Comment body (markdown)" },
        },
        required: ["pr", "body"],
      },
    },
    execute: (input, ctx) => ghPrComment(input as { pr: string; body: string }, ctx),
  },
  gh_pr_checkout: {
    mutating: true,
    definition: {
      name: "gh_pr_checkout",
      description: "Checkout a GitHub pull request locally via GitHub CLI (gh).",
      inputSchema: {
        type: "object",
        properties: { pr: { type: "string", description: "PR number, branch name, or URL" } },
        required: ["pr"],
      },
    },
    execute: (input, ctx) => ghPrCheckout(input as { pr: string }, ctx),
  },
};

import { registry } from "./registry.js";
import { taskStore } from "../tasks/taskStore.js";
import { spawnWorker, stopWorker, listWorkers } from "../tasks/agentWorker.js";
import {
  createTeam,
  deleteTeam,
  listTeams,
  assignTaskToTeam,
  sendMessage as sendAgentMessage,
  getMessages,
  clearMessages,
} from "../tasks/teamManager.js";

import { mcpManager } from "./MCPConnectionManager.js";

// ── Register legacy tools ────────────────────────────────────────────────────

Object.entries(TOOLS).forEach(([name, tool]) => {
  registry.register({ ...tool, category: "FILE OPERATIONS" });
});

// ── Register Search & Discovery tools ────────────────────────────────────────

import { getIntel } from "./intel.js";

registry.register({
  mutating: false,
  category: "SEARCH & DISCOVERY",
  definition: {
    name: "intel_day",
    description: "Load knowledge from the .yoof1337-mem/ directory. Omit the query to list all available intelligence files, or provide a filename/topic to read it.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional filename or topic to search for in memory." },
      },
      required: [],
    },
  },
  execute: async (input, ctx) => {
    try {
      return await getIntel(ctx.root, input.query as string | undefined);
    } catch (err: any) {
      return `Error accessing intel: ${err.message}`;
    }
  },
});

// ── Register MCP Protocol tools ──────────────────────────────────────────────

registry.register({
  mutating: false,
  category: "MCP PROTOCOL",
  definition: {
    name: "mcp_list_resources",
    description: "List available resources on a specific MCP server.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", description: "Name of the MCP server" },
      },
      required: ["server"],
    },
  },
  execute: async (input) => {
    const server = String(input.server);
    const client = mcpManager.getClient(server);
    if (!client) return `Error: No active connection to MCP server "${server}".`;
    try {
      const res = await client.listResources();
      if (!res.resources.length) return `No resources found on ${server}.`;
      return JSON.stringify(res.resources, null, 2);
    } catch (err) {
      return `Error listing resources: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
});

registry.register({
  mutating: false,
  category: "MCP PROTOCOL",
  definition: {
    name: "mcp_read_resource",
    description: "Read a specific resource from an MCP server using its URI.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", description: "Name of the MCP server" },
        uri: { type: "string", description: "URI of the resource to read" },
      },
      required: ["server", "uri"],
    },
  },
  execute: async (input) => {
    const server = String(input.server);
    const uri = String(input.uri);
    const client = mcpManager.getClient(server);
    if (!client) return `Error: No active connection to MCP server "${server}".`;
    try {
      const res = await client.readResource({ uri });
      return JSON.stringify(res.contents, null, 2);
    } catch (err) {
      return `Error reading resource: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
});

// ── Register AGENT / TASK tools ──────────────────────────────────────────────

registry.register({
  mutating: false,
  category: "AGENT / TASK",
  definition: {
    name: "task_create",
    description: "Create a new background task and optionally assign it to a team. Returns the task ID.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The task instructions / prompt for the sub-agent" },
        assignee: { type: "string", description: "Optional team name to assign the task to" },
        mode: { type: "string", enum: ["default", "fork", "worktree"], description: "Spawn mode for the task" },
        dependencies: { type: "array", items: { type: "string" }, description: "List of Task IDs that must complete before this task starts" },
      },
      required: ["prompt"],
    },
  },
  execute: async (input, ctx) => {
    const prompt = String(input.prompt ?? "");
    const assignee = input.assignee ? String(input.assignee) : "unassigned";
    const mode = input.mode as any;
    const dependencies = Array.isArray(input.dependencies) ? input.dependencies.map(String) : [];

    const isReady = dependencies.every(id => {
      const d = taskStore.get(id);
      return d && d.status === "completed";
    });

    if (assignee !== "unassigned") {
      try {
        const taskId = assignTaskToTeam(assignee, prompt, ctx, mode, dependencies);
        if (!isReady) return `Task created and assigned to team "${assignee}": ${taskId} (waiting on dependencies)`;
        return `Task created and assigned to team "${assignee}": ${taskId}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    const task = taskStore.create({ prompt, assignee: "unassigned", dependencies });
    if (isReady) {
      spawnWorker(task.id, { sandbox: ctx, mode });
      return `Task created: ${task.id} (running in ${mode || "default"} mode)`;
    } else {
      return `Task created: ${task.id} (waiting on dependencies)`;
    }
  },
});

registry.register({
  mutating: false,
  category: "AGENT / TASK",
  definition: {
    name: "task_get",
    description: "Get the status and metadata of a task by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID" },
      },
      required: ["id"],
    },
  },
  execute: async (input) => {
    const task = taskStore.get(String(input.id));
    if (!task) return `Error: task "${input.id}" not found.`;
    return JSON.stringify({
      id: task.id,
      status: task.status,
      assignee: task.assignee,
      prompt: task.prompt.slice(0, 200),
      result: task.result ? task.result.slice(0, 500) : null,
      error: task.error,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    }, null, 2);
  },
});

registry.register({
  mutating: true,
  category: "AGENT / TASK",
  definition: {
    name: "task_update",
    description: "Update a task's metadata.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID" },
        metadata: { type: "object", description: "Key-value metadata to merge into the task" },
      },
      required: ["id"],
    },
  },
  execute: async (input) => {
    const task = taskStore.update(String(input.id), {
      metadata: (input.metadata as Record<string, unknown>) ?? {},
    });
    if (!task) return `Error: task "${input.id}" not found.`;
    return `Task ${task.id} updated.`;
  },
});

registry.register({
  mutating: false,
  category: "AGENT / TASK",
  definition: {
    name: "task_list",
    description: "List all tasks, optionally filtered by status or assignee.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "running", "completed", "failed", "stopped"] },
        assignee: { type: "string", description: "Filter by team/assignee name" },
      },
    },
  },
  execute: async (input) => {
    const tasks = taskStore.list({
      status: input.status as any,
      assignee: input.assignee ? String(input.assignee) : undefined,
    });
    if (tasks.length === 0) return "(no tasks)";
    return tasks.map(t =>
      `[${t.status}] ${t.id} (${t.assignee}) — ${t.prompt.slice(0, 80)}`
    ).join("\n");
  },
});

registry.register({
  mutating: true,
  category: "AGENT / TASK",
  definition: {
    name: "task_stop",
    description: "Stop a running task and its associated agent worker.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID to stop" },
      },
      required: ["id"],
    },
  },
  execute: async (input) => {
    const id = String(input.id);
    const stopped = stopWorker(id);
    if (stopped) return `Task ${id} stopped.`;
    const task = taskStore.stop(id);
    if (task) return `Task ${id} marked as stopped (worker already finished).`;
    return `Error: task "${id}" not found.`;
  },
});

registry.register({
  mutating: false,
  category: "AGENT / TASK",
  definition: {
    name: "task_output",
    description: "Get the full output log of a task (stdout from the sub-agent).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID" },
        tail: { type: "number", description: "Only return the last N lines (optional)" },
      },
      required: ["id"],
    },
  },
  execute: async (input) => {
    const output = taskStore.getOutput(String(input.id));
    if (output === undefined) return `Error: task "${input.id}" not found.`;
    if (!output) return "(no output yet)";
    const tail = typeof input.tail === "number" ? input.tail : 0;
    if (tail > 0) {
      const lines = output.split("\n");
      return lines.slice(-tail).join("\n");
    }
    return output;
  },
});

registry.register({
  mutating: true,
  category: "AGENT / TASK",
  definition: {
    name: "agent_run",
    description: "Spawn a background sub-agent with a custom system prompt to run a task asynchronously. Returns the task ID.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The task prompt for the sub-agent" },
        systemPrompt: { type: "string", description: "Custom system prompt (role/personality) for the sub-agent" },
        provider: { type: "string", description: "LLM provider override for the sub-agent" },
        mode: { type: "string", enum: ["default", "fork", "worktree"], description: "Spawn mode (default=in-process, fork=isolated process, worktree=isolated process + git worktree)" },
        dependencies: { type: "array", items: { type: "string" }, description: "List of Task IDs that must complete before this task starts" },
      },
      required: ["prompt"],
    },
  },
  execute: async (input, ctx) => {
    const mode = input.mode as any;
    const dependencies = Array.isArray(input.dependencies) ? input.dependencies.map(String) : [];

    const isReady = dependencies.every(id => {
      const d = taskStore.get(id);
      return d && d.status === "completed";
    });

    const task = taskStore.create({
      prompt: String(input.prompt),
      assignee: "agent",
      dependencies,
    });

    if (isReady) {
      spawnWorker(task.id, {
        sandbox: ctx,
        systemPrompt: input.systemPrompt ? String(input.systemPrompt) : undefined,
        provider: input.provider ? String(input.provider) : undefined,
        mode,
      });
      return `Sub-agent spawned: task ${task.id} (running in ${mode || "default"} mode).`;
    } else {
      return `Sub-agent task created: ${task.id} (waiting on dependencies).`;
    }
  },
});

import { getWorkspaceManager } from "../tasks/workspaceManager.js";

registry.register({
  mutating: true,
  category: "AGENT / TASK",
  definition: {
    name: "workspace_merge",
    description: "Merge an isolated worktree branch back into the main sandbox repository.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID of the worktree to merge" },
      },
      required: ["taskId"],
    },
  },
  execute: async (input, ctx) => {
    try {
      const wm = getWorkspaceManager(ctx.root);
      wm.mergeWorktree(String(input.taskId), ctx.root);
      return `Successfully merged worktree for task ${input.taskId} into current branch.`;
    } catch (err: any) {
      return `Error merging worktree: ${err.message}`;
    }
  },
});

registry.register({
  mutating: true,
  category: "AGENT / TASK",
  definition: {
    name: "workspace_delete",
    description: "Delete an isolated worktree and its branch.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID of the worktree to delete" },
      },
      required: ["taskId"],
    },
  },
  execute: async (input, ctx) => {
    try {
      const wm = getWorkspaceManager(ctx.root);
      wm.removeWorktree(String(input.taskId), ctx.root);
      return `Successfully deleted worktree for task ${input.taskId}.`;
    } catch (err: any) {
      return `Error deleting worktree: ${err.message}`;
    }
  },
});

registry.register({
  mutating: true,
  category: "AGENT / TASK",
  definition: {
    name: "team_create",
    description: "Create a named team of agents with a shared system prompt and optional provider override.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Team name (unique)" },
        systemPrompt: { type: "string", description: "System prompt shared by all agents on this team" },
        provider: { type: "string", description: "Optional LLM provider override" },
      },
      required: ["name", "systemPrompt"],
    },
  },
  execute: async (input) => {
    try {
      const team = createTeam(String(input.name), String(input.systemPrompt), input.provider ? String(input.provider) : undefined);
      return `Team "${team.name}" created.`;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
});

registry.register({
  mutating: true,
  category: "AGENT / TASK",
  definition: {
    name: "team_delete",
    description: "Delete a team and stop all its active tasks.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Team name" },
      },
      required: ["name"],
    },
  },
  execute: async (input) => {
    const deleted = deleteTeam(String(input.name));
    return deleted ? `Team "${input.name}" deleted.` : `Error: team "${input.name}" not found.`;
  },
});

registry.register({
  mutating: false,
  category: "AGENT / TASK",
  definition: {
    name: "send_message",
    description: "Send a message to another agent (identified by task ID). The recipient can read it with task_output.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Sender identifier (e.g. 'lead' or a task ID)" },
        to: { type: "string", description: "Recipient task ID" },
        content: { type: "string", description: "Message content" },
      },
      required: ["from", "to", "content"],
    },
  },
  execute: async (input) => {
    sendAgentMessage(String(input.from), String(input.to), String(input.content));
    return `Message sent from "${input.from}" to "${input.to}".`;
  },
});

// ── Register Planning & Workflow tools ───────────────────────────────────────

import fs from "fs";
import path from "path";

registry.register({
  mutating: true,
  category: "PLANNING & WORKFLOW",
  definition: {
    name: "plan_create",
    description: "Create an implementation plan artifact and explicitly wait for user approval.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the plan" },
        content: { type: "string", description: "Detailed markdown content of the plan" },
      },
      required: ["title", "content"],
    },
  },
  execute: async (input, ctx) => {
    const planPath = path.join(ctx.root, "implementation_plan.md");
    const content = `# ${input.title}\n\n${input.content}\n\n> [!IMPORTANT]\n> Please review this plan and provide feedback or approval before I proceed.`;
    fs.writeFileSync(planPath, content, "utf-8");
    return `Plan created at ${planPath}. PAUSE EXECUTION and ask the user for approval.`;
  },
});

registry.register({
  mutating: true,
  category: "PLANNING & WORKFLOW",
  definition: {
    name: "walkthrough_generate",
    description: "Generate a walkthrough markdown artifact summarizing completed changes.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Markdown content of the walkthrough" },
      },
      required: ["content"],
    },
  },
  execute: async (input, ctx) => {
    const wtPath = path.join(ctx.root, "walkthrough.md");
    fs.writeFileSync(wtPath, String(input.content), "utf-8");
    return `Walkthrough created at ${wtPath}.`;
  },
});

// ── Register Web & Network tools ─────────────────────────────────────────────

import { webFetch } from "./web/webFetch.js";
import { webSearch } from "./web/webSearch.js";

registry.register({
  mutating: false,
  category: "WEB & NETWORK",
  definition: {
    name: "web_search",
    description: "Perform an unauthenticated web search to find information, documentation, or solutions.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
      },
      required: ["query"],
    },
  },
  execute: async (input) => {
    try {
      const results = await webSearch(String(input.query));
      if (results.length === 0) return "No results found.";
      return results.map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`).join("\n\n");
    } catch (err: any) {
      return `Error performing web search: ${err.message}`;
    }
  },
});

registry.register({
  mutating: true,
  category: "WEB & NETWORK",
  definition: {
    name: "web_fetch",
    description: "Fetch the text content of a webpage or URL.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
      },
      required: ["url"],
    },
  },
  execute: async (input) => {
    try {
      const { title, content } = await webFetch(String(input.url));
      // Truncate if too long, arbitrary limit
      const maxLength = 20000;
      let text = content;
      if (text.length > maxLength) {
        text = text.substring(0, maxLength) + "\n\n... (content truncated)";
      }
      return `# ${title}\n\n${text}`;
    } catch (err: any) {
      return `Error fetching URL: ${err.message}`;
    }
  },
});

export function toolDefinitions(): ToolDefinition[] {
  return registry.getDefinitions();
}

/**
 * Execute a tool by name. All failures -- unknown tool, sandbox violations,
 * fs errors -- come back as strings so the model can see the error and react;
 * nothing here throws into the agent loop.
 */
export async function executeTool(name: string, input: Record<string, unknown>, ctx: SandboxContext): Promise<string> {
  const tool = registry.get(name);
  if (!tool) return `Error: unknown tool "${name}". Available: ${registry.getAll().map(t => t.definition.name).join(", ")}`;
  try {
    return await tool.execute(input, ctx);
  } catch (err) {
    if (err instanceof SandboxViolationError) return `Error: ${err.message}`;
    const msg = err instanceof Error ? err.message : String(err);
    return `Error executing ${name}: ${msg}`;
  }
}
