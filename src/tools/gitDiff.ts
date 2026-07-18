import { execa } from "execa";
import type { SandboxContext } from "./sandbox.js";

export async function gitDiff(
  input: { cached?: boolean; path?: string },
  ctx: SandboxContext
): Promise<string> {
  const args = ["diff"];
  if (input.cached) args.push("--cached");
  if (input.path) args.push("--", input.path);
  const res = await execa("git", args, {
    cwd: ctx.root,
    timeout: ctx.commandTimeoutMs,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  return res.stdout || "(no diff)";
}

