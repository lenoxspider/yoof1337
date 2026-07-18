import { execa } from "execa";
import type { SandboxContext } from "./sandbox.js";

export async function gitStatus(_input: Record<string, unknown>, ctx: SandboxContext): Promise<string> {
  const res = await execa("git", ["status", "--porcelain=v1", "-b"], {
    cwd: ctx.root,
    timeout: ctx.commandTimeoutMs,
    windowsHide: true,
  });
  return res.stdout || "(clean)";
}

