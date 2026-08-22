import fs from "node:fs/promises";
import path from "node:path";
import { resolveInSandbox, type SandboxContext } from "./sandbox.js";

export async function moveFile(
  input: { source: string; destination: string; overwrite?: boolean },
  ctx: SandboxContext
): Promise<string> {
  const src = resolveInSandbox(ctx, input.source);
  const dest = resolveInSandbox(ctx, input.destination);

  try {
    const srcStat = await fs.stat(src);
    
    // Ensure destination parent directory exists
    const destDir = path.dirname(dest);
    await fs.mkdir(destDir, { recursive: true });

    // Check if destination exists
    try {
      await fs.stat(dest);
      if (!input.overwrite) {
        return `Error: destination "${input.destination}" already exists. Pass overwrite: true to replace it.`;
      }
    } catch {
      // destination does not exist, which is fine
    }

    try {
      await fs.rename(src, dest);
    } catch (renameErr: any) {
      // Cross-device rename fallback: copy and remove
      if (renameErr.code === "EXDEV") {
        await fs.cp(src, dest, { recursive: true, force: true });
        await fs.rm(src, { recursive: srcStat.isDirectory(), force: true });
      } else {
        throw renameErr;
      }
    }

    return `Moved "${input.source}" -> "${input.destination}".`;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return `Error: source "${input.source}" does not exist.`;
    }
    return `Error moving "${input.source}": ${err.message}`;
  }
}
