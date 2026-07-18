import fs from "node:fs/promises";
import { resolveInSandbox, type SandboxContext } from "./sandbox.js";

const MAX_BYTES = 256 * 1024;

export async function readFile(
  input: { path: string },
  ctx: SandboxContext
): Promise<string> {
  const target = resolveInSandbox(ctx, input.path);
  const stat = await fs.stat(target);
  if (stat.isDirectory()) {
    return `Error: "${input.path}" is a directory. Use list_directory instead.`;
  }
  if (stat.size > MAX_BYTES) {
    const fh = await fs.open(target, "r");
    try {
      const buf = Buffer.alloc(MAX_BYTES);
      await fh.read(buf, 0, MAX_BYTES, 0);
      return (
        buf.toString("utf8") +
        `\n\n[truncated: file is ${stat.size} bytes, showing first ${MAX_BYTES}]`
      );
    } finally {
      await fh.close();
    }
  }
  return await fs.readFile(target, "utf8");
}
