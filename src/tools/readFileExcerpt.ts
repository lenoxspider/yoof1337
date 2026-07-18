import fs from "node:fs/promises";
import { resolveInSandbox, type SandboxContext } from "./sandbox.js";

export async function readFileExcerpt(
  input: { path: string; startLine?: number; endLine?: number; maxBytes?: number },
  ctx: SandboxContext
): Promise<string> {
  const target = resolveInSandbox(ctx, input.path);
  const maxBytes = Math.max(1_024, Math.min(512 * 1024, Number(input.maxBytes ?? 256 * 1024)));

  const stat = await fs.stat(target);
  if (stat.isDirectory()) return `Error: "${input.path}" is a directory.`;

  const raw = await fs.readFile(target, "utf8");
  const lines = raw.split(/\r?\n/);
  const start = clampLine(input.startLine ?? 1, lines.length);
  const end = clampLine(input.endLine ?? Math.min(lines.length, start + 200), lines.length);
  const slice = lines.slice(start - 1, end);

  let out = slice.map((l, i) => `${start + i}: ${l}`).join("\n");
  if (Buffer.byteLength(out, "utf8") > maxBytes) {
    out = out.slice(0, maxBytes) + "\n[truncated]";
  }
  return out;
}

function clampLine(n: number, max: number): number {
  if (!Number.isFinite(n)) return 1;
  const v = Math.floor(n);
  if (v < 1) return 1;
  if (v > max) return max;
  return v;
}

