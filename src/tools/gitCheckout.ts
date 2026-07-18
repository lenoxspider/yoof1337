import { execa } from "execa";
import type { SandboxContext } from "./sandbox.js";

export async function gitCheckout(input: { ref: string; create?: boolean }, ctx: SandboxContext): Promise<string> {
  const ref = String(input.ref ?? "").trim();
  if (!ref) return "Error: ref is required.";
  const args = ["checkout"];
  if (input.create) args.push("-b");
  args.push(ref);
  const res = await execa("git", args, {
    cwd: ctx.root,
    timeout: ctx.commandTimeoutMs,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    reject: false,
  });
  if (res.exitCode !== 0) return res.stderr || res.stdout || "(git checkout failed)";
  return res.stdout || "(ok)";
}

