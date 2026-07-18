import fs from "node:fs/promises";
import path from "node:path";
import { parsePatch, applyPatch as applyOnePatch } from "diff";
import { resolveInSandbox, type SandboxContext } from "./sandbox.js";

export async function applyPatch(
  input: { patch: string },
  ctx: SandboxContext
): Promise<string> {
  const patchText = String(input.patch ?? "");
  if (!patchText.trim()) return "Error: patch is required.";

  let parsed;
  try {
    parsed = parsePatch(patchText);
  } catch (err) {
    return `Error: failed to parse unified diff: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return "Error: patch contained no file diffs.";

  const results: string[] = [];

  for (const filePatch of parsed) {
    const fileName = pickFilename(filePatch.oldFileName, filePatch.newFileName);
    if (!fileName) {
      results.push("Error: patch missing file name.");
      continue;
    }

    const rel = normalizePatchPath(fileName);
    if (!rel) {
      results.push(`Error: unsupported patch path "${fileName}".`);
      continue;
    }

    const target = resolveInSandbox(ctx, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });

    const current = await fs.readFile(target, "utf8").catch(() => "");
    const next = applyOnePatch(current, filePatch as any);
    if (next === false) {
      results.push(`FAIL  ${rel} (hunks did not apply cleanly)`);
      continue;
    }
    await fs.writeFile(target, next, "utf8");
    results.push(`OK    ${rel}`);
  }

  return results.join("\n");
}

function pickFilename(oldName?: string, newName?: string): string | null {
  const candidates = [newName, oldName].filter(Boolean) as string[];
  if (candidates.length === 0) return null;
  // diff lib uses "a/file" and "b/file" sometimes; also may contain timestamps after \t.
  return candidates[0].split("\t")[0];
}

function normalizePatchPath(p: string): string | null {
  const s = p.replace(/\\/g, "/").trim();
  if (s === "/dev/null") return null;
  if (s.startsWith("a/") || s.startsWith("b/")) return s.slice(2);
  // Disallow absolute paths and drive paths.
  if (/^[a-zA-Z]:\//.test(s)) return null;
  if (s.startsWith("/")) return null;
  return s;
}

