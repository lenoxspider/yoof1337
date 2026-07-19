import fs from "node:fs/promises";
import path from "node:path";
import { resolveInSandbox, type SandboxContext } from "./sandbox.js";

export type EditMode = "replace" | "append" | "prepend" | "multi_replace";

export interface ReplacementChunk {
  find: string;
  replace: string;
  expectedOccurrences?: number;
}

/**
 * Safer-than-overwrite file editing primitive.
 * - replace: exact substring replacement with occurrence checks
 * - multi_replace: exact substring replacement of multiple chunks in one pass
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
    chunks?: ReplacementChunk[];
  },
  ctx: SandboxContext
): Promise<string> {
  const target = resolveInSandbox(ctx, input.path);
  await fs.mkdir(path.dirname(target), { recursive: true });

  const mode = input.mode;
  let current = await fs.readFile(target, "utf8").catch(() => "");

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

  if (mode === "multi_replace") {
    const chunks = input.chunks ?? [];
    if (!chunks.length) return "Error: chunks array is required for mode=multi_replace.";
    let totalReplaced = 0;
    
    for (const chunk of chunks) {
      const find = String(chunk.find ?? "");
      const replace = String(chunk.replace ?? "");
      if (!find) return `Error: 'find' is missing in one of the chunks.`;

      const occurrences = countOccurrences(current, find);
      const expected = chunk.expectedOccurrences;
      if (typeof expected === "number" && occurrences !== expected) {
        return `Error: expectedOccurrences=${expected} but found ${occurrences} matches for text:\n${find}\nin ${input.path}.`;
      }
      if (occurrences === 0) return `Error: no matches found for text:\n${find}\nin ${input.path}.`;

      current = current.split(find).join(replace);
      totalReplaced += occurrences;
    }
    
    await fs.writeFile(target, current, "utf8");
    return `Replaced ${totalReplaced} occurrence(s) across ${chunks.length} chunks in ${input.path}.`;
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

