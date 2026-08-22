import fs from "node:fs/promises";
import { resolveInSandbox, type SandboxContext } from "./sandbox.js";

export async function deleteFile(
  input: { path: string; recursive?: boolean },
  ctx: SandboxContext
): Promise<string> {
  const target = resolveInSandbox(ctx, input.path);
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      if (!input.recursive) {
        return `Error: "${input.path}" is a directory. Set recursive: true to delete it.`;
      }
      await fs.rm(target, { recursive: true, force: true });
      return `Deleted directory "${input.path}" recursively.`;
    }
    await fs.unlink(target);
    return `Deleted file "${input.path}".`;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return `Error: "${input.path}" does not exist.`;
    }
    return `Error deleting "${input.path}": ${err.message}`;
  }
}
