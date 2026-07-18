import { execa } from "execa";
import type { SandboxContext } from "./sandbox.js";

function isCommandNotFound(err: unknown): boolean {
  return err instanceof Error && /ENOENT|not recognized|not found/i.test(err.message);
}

async function gh(args: string[], ctx: SandboxContext): Promise<string> {
  try {
    const res = await execa("gh", args, {
      cwd: ctx.root,
      timeout: ctx.commandTimeoutMs,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    return res.stdout || res.stderr || "(ok)";
  } catch (err) {
    if (isCommandNotFound(err)) {
      return `Error: GitHub CLI (gh) not found. Install it and run "gh auth login".`;
    }
    const msg = err instanceof Error ? err.message : String(err);
    return `Error: gh ${args.join(" ")} failed: ${msg}`;
  }
}

export async function ghAuthStatus(_input: Record<string, unknown>, ctx: SandboxContext): Promise<string> {
  return gh(["auth", "status"], ctx);
}

export async function ghPrView(input: { pr: string }, ctx: SandboxContext): Promise<string> {
  const pr = String(input.pr ?? "").trim();
  if (!pr) return "Error: pr is required (number, branch, or URL).";
  return gh(["pr", "view", pr], ctx);
}

export async function ghPrDiff(input: { pr: string }, ctx: SandboxContext): Promise<string> {
  const pr = String(input.pr ?? "").trim();
  if (!pr) return "Error: pr is required (number, branch, or URL).";
  return gh(["pr", "diff", pr], ctx);
}

export async function ghIssueView(input: { issue: string }, ctx: SandboxContext): Promise<string> {
  const issue = String(input.issue ?? "").trim();
  if (!issue) return "Error: issue is required (number or URL).";
  return gh(["issue", "view", issue], ctx);
}

export async function ghRepoView(_input: Record<string, unknown>, ctx: SandboxContext): Promise<string> {
  return gh(["repo", "view"], ctx);
}

export async function ghPrCreate(
  input: { title: string; body?: string; draft?: boolean; base?: string; head?: string },
  ctx: SandboxContext
): Promise<string> {
  const title = String(input.title ?? "").trim();
  if (!title) return "Error: title is required.";
  const args = ["pr", "create", "--title", title];
  if (input.body) args.push("--body", String(input.body));
  else args.push("--body", "");
  if (input.draft) args.push("--draft");
  if (input.base) args.push("--base", String(input.base));
  if (input.head) args.push("--head", String(input.head));
  return gh(args, ctx);
}

export async function ghPrComment(input: { pr: string; body: string }, ctx: SandboxContext): Promise<string> {
  const pr = String(input.pr ?? "").trim();
  const body = String(input.body ?? "");
  if (!pr) return "Error: pr is required (number, branch, or URL).";
  if (!body.trim()) return "Error: body is required.";
  return gh(["pr", "comment", pr, "--body", body], ctx);
}

export async function ghPrCheckout(input: { pr: string }, ctx: SandboxContext): Promise<string> {
  const pr = String(input.pr ?? "").trim();
  if (!pr) return "Error: pr is required (number, branch, or URL).";
  return gh(["pr", "checkout", pr], ctx);
}
