import { execa } from "execa";
import type { SandboxContext } from "./sandbox.js";

export async function gitLog(input: { n?: number }, ctx: SandboxContext): Promise<string> {
  const n = Math.max(1, Math.min(50, Number(input.n ?? 20)));
  const res = await execa("git", ["log", `-n`, String(n), "--oneline", "--decorate"], {
    cwd: ctx.root,
    timeout: ctx.commandTimeoutMs,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    reject: false,
  });
  if (res.exitCode !== 0) return res.stderr || res.stdout || "(git log failed)";
  return res.stdout || "(no commits)";
}

