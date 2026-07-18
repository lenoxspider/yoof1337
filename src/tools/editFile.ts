import fs from "node:fs/promises";
import path from "node:path";
import { resolveInSandbox, type SandboxContext } from "./sandbox.js";

export type EditMode = "replace" | "append" | "prepend";

/**
 * Safer-than-overwrite file editing primitive.
 * - replace: exact substring replacement with occurrence checks
 * - append/prepend: add text without touching existing content
 */
export async function editFile(
  input: {
    path: string;
    mode: EditMode;
    find?: string;
    replace?: string;
    text?: string;
    expectedOccurrences?: number;
  },
  ctx: SandboxContext
): Promise<string> {
  const target = resolveInSandbox(ctx, input.path);
  await fs.mkdir(path.dirname(target), { recursive: true });

  const mode = input.mode;
  const current = await fs.readFile(target, "utf8").catch(() => "");

  if (mode === "append") {
    const text = String(input.text ?? "");
    await fs.writeFile(target, current + text, "utf8");
    return `Appended ${Buffer.byteLength(text, "utf8")} bytes to ${input.path}.`;
  }

  if (mode === "prepend") {
    const text = String(input.text ?? "");
    await fs.writeFile(target, text + current, "utf8");
    return `Prepended ${Buffer.byteLength(text, "utf8")} bytes to ${input.path}.`;
  }

  if (mode !== "replace") return `Error: unknown edit mode "${String(mode)}".`;
  const find = String(input.find ?? "");
  const replace = String(input.replace ?? "");
  if (!find) return "Error: find is required for mode=replace.";

  const occurrences = countOccurrences(current, find);
  const expected = input.expectedOccurrences;
  if (typeof expected === "number" && occurrences !== expected) {
    return `Error: expectedOccurrences=${expected} but found ${occurrences} matches in ${input.path}.`;
  }
  if (occurrences === 0) return `Error: no matches found for the given find string in ${input.path}.`;

  const next = current.split(find).join(replace);
  await fs.writeFile(target, next, "utf8");
  return `Replaced ${occurrences} occurrence(s) in ${input.path}.`;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  for (;;) {
    const next = haystack.indexOf(needle, idx);
    if (next === -1) break;
    count++;
    idx = next + needle.length;
  }
  return count;
}

