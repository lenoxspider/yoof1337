import type { SandboxContext } from "./sandbox.js";
import { killProcess } from "./processStore.js";

export async function killCommand(input: { id: string }, _ctx: SandboxContext): Promise<string> {
  const id = String(input.id ?? "").trim();
  if (!id) return "Error: id is required.";
  const ok = killProcess(id);
  return ok ? `OK: killed (or already exited) ${id}` : `Error: unknown id "${id}" or failed to kill.`;
}

