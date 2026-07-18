import fs from "node:fs/promises";
import path from "node:path";
import { resolveInSandbox, type SandboxContext } from "./sandbox.js";

export async function writeFile(
  input: { path: string; content: string },
  ctx: SandboxContext
): Promise<string> {
  const target = resolveInSandbox(ctx, input.path);
  await fs.mkdir(path.dirname(target), { recursive: true });
  let existed = false;
  try {
    await fs.access(target);
    existed = true;
  } catch {
    // new file
  }
  await fs.writeFile(target, input.content, "utf8");
  const bytes = Buffer.byteLength(input.content, "utf8");
  return `${existed ? "Overwrote" : "Created"} ${input.path} (${bytes} bytes).`;
}
