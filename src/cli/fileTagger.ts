import fs from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";
import type { SandboxContext } from "../tools/sandbox.js";
import { resolveInSandbox } from "../tools/sandbox.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv", "venv", ".cache"]);

export interface TaggedFileResult {
  expandedText: string;
  attachedFiles: string[];
}

/**
 * Parses user input for `@filepath` tokens, loads their contents if valid,
 * and attaches them as structured context blocks.
 */
export async function expandFileTags(text: string, ctx: SandboxContext): Promise<TaggedFileResult> {
  const fileTagRegex = /(?:^|\s)@([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)/g;
  const attachedFiles: string[] = [];
  const attachments: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = fileTagRegex.exec(text)) !== null) {
    const relPath = match[1].replace(/\\/g, "/");
    try {
      const fullPath = resolveInSandbox(ctx, relPath);
      const stat = await fs.stat(fullPath);
      if (stat.isFile()) {
        const content = await fs.readFile(fullPath, "utf-8");
        attachedFiles.push(relPath);
        const truncated = content.length > 30000 ? content.slice(0, 30000) + "\n... [content truncated to 30KB]" : content;
        attachments.push(`--- Attached file: ${relPath} ---\n\`\`\`\n${truncated}\n\`\`\``);
      }
    } catch {
      // Not a valid file path, leave as is
    }
  }

  if (attachments.length === 0) {
    return { expandedText: text, attachedFiles: [] };
  }

  const expandedText = `${attachments.join("\n\n")}\n\n${text}`;
  return { expandedText, attachedFiles };
}

/**
 * Searches for files matching a query for `@` autocomplete in the TUI.
 */
export async function searchFilesForAutocomplete(root: string, query: string, limit = 10): Promise<string[]> {
  const matches: string[] = [];
  const cleanQuery = query.toLowerCase().replace(/\\/g, "/");

  let ig = ignore();
  try {
    const raw = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    ig.add(raw.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#")));
  } catch {
    // ignore
  }

  async function walk(dir: string, currentDepth: number): Promise<void> {
    if (currentDepth > 5 || matches.length >= limit) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const e of entries) {
      if (matches.length >= limit) return;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        const rel = path.relative(root, full).replace(/\\/g, "/");
        if (ig.ignores(rel) || ig.ignores(rel + "/")) continue;
        await walk(full, currentDepth + 1);
      } else if (e.isFile()) {
        const full = path.join(dir, e.name);
        const rel = path.relative(root, full).replace(/\\/g, "/");
        if (ig.ignores(rel)) continue;
        if (!cleanQuery || rel.toLowerCase().includes(cleanQuery)) {
          matches.push(rel);
        }
      }
    }
  }

  await walk(root, 1);
  return matches.slice(0, limit);
}
