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
          mode: { type: "string", enum: ["replace", "append", "prepend"], description: "Edit mode" },
          find: { type: "string", description: "Exact substring to find (mode=replace)" },
          replace: { type: "string", description: "Replacement text (mode=replace)" },
          text: { type: "string", description: "Text to append/prepend (mode=append|prepend)" },
          expectedOccurrences: { type: "number", description: "If set, replacement must match exactly this many times" },
        },
        required: ["path", "mode"],
      },
    },
    execute: (input, ctx) =>
      editFile(
        input as {
          path: string;
          mode: "replace" | "append" | "prepend";
          find?: string;
          replace?: string;
          text?: string;
          expectedOccurrences?: number;
        },
        ctx
      ),
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

export function toolDefinitions(): ToolDefinition[] {
  return Object.values(TOOLS).map((t) => t.definition);
}

/**
 * Execute a tool by name. All failures -- unknown tool, sandbox violations,
 * fs errors -- come back as strings so the model can see the error and react;
 * nothing here throws into the agent loop.
 */
export async function executeTool(name: string, input: Record<string, unknown>, ctx: SandboxContext): Promise<string> {
  const tool = TOOLS[name];
  if (!tool) return `Error: unknown tool "${name}". Available: ${Object.keys(TOOLS).join(", ")}`;
  try {
    return await tool.execute(input, ctx);
  } catch (err) {
    if (err instanceof SandboxViolationError) return `Error: ${err.message}`;
    const msg = err instanceof Error ? err.message : String(err);
    return `Error executing ${name}: ${msg}`;
  }
}
