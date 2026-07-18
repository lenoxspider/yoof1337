import { execa } from "execa";
import type { SandboxContext } from "./sandbox.js";

export async function gitAdd(input: { paths?: string[] }, ctx: SandboxContext): Promise<string> {
  const paths = Array.isArray(input.paths) && input.paths.length > 0 ? input.paths : ["-A"];
  const args = ["add", ...paths];
  const res = await execa("git", args, {
    cwd: ctx.root,
    timeout: ctx.commandTimeoutMs,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    reject: false,
  });
  if (res.exitCode !== 0) return res.stderr || res.stdout || "(git add failed)";
  return res.stdout || "(staged)";
}

