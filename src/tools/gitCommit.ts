import { execa } from "execa";
import type { SandboxContext } from "./sandbox.js";

export async function gitCommit(input: { message: string }, ctx: SandboxContext): Promise<string> {
  const msg = String(input.message ?? "").trim();
  if (!msg) return "Error: commit message is required.";
  const res = await execa("git", ["commit", "-m", msg], {
    cwd: ctx.root,
    timeout: ctx.commandTimeoutMs,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  return res.stdout || res.stderr || "(ok)";
}

