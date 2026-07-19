import type { SandboxContext } from "./sandbox.js";
import { getProcess, pruneExited } from "./processStore.js";

export async function checkCommand(input: { id: string }, _ctx: SandboxContext): Promise<string> {
  const id = String(input.id ?? "").trim();
  if (!id) return "Error: id is required.";
  pruneExited();
  const rec = getProcess(id);
  if (!rec) return `Error: unknown command id "${id}".`;

  const status = rec.exitedAt ? "exited" : "running";
  const exit =
    rec.exitedAt ? `exitCode: ${rec.timedOut ? 124 : rec.exitCode ?? "(null)"}${rec.timedOut ? " (timeout)" : ""}` : "";

  return [
    `id: ${rec.id}`,
    `status: ${status}`,
    `command: ${rec.command}`,
    `startedAt: ${rec.startedAt}`,
    rec.exitedAt ? `exitedAt: ${rec.exitedAt}` : "",
    exit,
    `stdout:\n${rec.stdout || "(empty)"}`,
    `stderr:\n${rec.stderr || "(empty)"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

