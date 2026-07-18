import fs from "node:fs/promises";
import { resolveInSandbox, type SandboxContext } from "./sandbox.js";

export async function listDirectory(
  input: { path?: string },
  ctx: SandboxContext
): Promise<string> {
  const target = resolveInSandbox(ctx, input.path ?? ".");
  const entries = await fs.readdir(target, { withFileTypes: true });
  if (entries.length === 0) return "(empty directory)";
  const lines = await Promise.all(
    entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (e) => {
        if (e.isDirectory()) return `${e.name}/`;
        try {
          const stat = await fs.stat(resolveInSandbox(ctx, `${input.path ?? "."}/${e.name}`));
          return `${e.name}  (${stat.size} bytes)`;
        } catch {
          return e.name;
        }
      })
  );
  return lines.join("\n");
}
