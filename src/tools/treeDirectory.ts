import fs from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";
import { resolveInSandbox, type SandboxContext } from "./sandbox.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv", "venv", ".turbo", ".cache"]);
const MAX_ENTRIES = 500;

export async function treeDirectory(
  input: { path?: string; maxDepth?: number },
  ctx: SandboxContext
): Promise<string> {
  const startRel = input.path ?? ".";
  const startAbs = resolveInSandbox(ctx, startRel);
  const maxDepth = Math.min(Math.max(1, input.maxDepth ?? 3), 6);
  const ig = await loadGitignore(ctx.root);

  const lines: string[] = [];
  let count = 0;

  async function walk(dir: string, currentDepth: number, prefix: string): Promise<void> {
    if (currentDepth > maxDepth || count >= MAX_ENTRIES) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      // Directories first, then alphabetical
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    // Filter ignored entries
    const validEntries = entries.filter((e) => {
      const full = path.join(dir, e.name);
      const rel = path.relative(ctx.root, full).replace(/\\/g, "/");
      if (e.isDirectory() && SKIP_DIRS.has(e.name)) return false;
      if (ig.ignores(rel) || ig.ignores(rel + "/")) return false;
      return true;
    });

    for (let i = 0; i < validEntries.length; i++) {
      if (count >= MAX_ENTRIES) {
        lines.push(`${prefix}... (maximum entry limit reached)`);
        return;
      }

      count++;
      const entry = validEntries[i];
      const isLast = i === validEntries.length - 1;
      const branch = isLast ? "└── " : "├── ";
      const childPrefix = prefix + (isLast ? "    " : "│   ");

      if (entry.isDirectory()) {
        lines.push(`${prefix}${branch}${entry.name}/`);
        await walk(path.join(dir, entry.name), currentDepth + 1, childPrefix);
      } else {
        lines.push(`${prefix}${branch}${entry.name}`);
      }
    }
  }

  lines.push(startRel === "." ? ctx.root : startRel);
  await walk(startAbs, 1, "");

  return lines.join("\n");
}

async function loadGitignore(root: string) {
  const ig = ignore();
  try {
    const raw = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    ig.add(raw.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#")));
  } catch {
    // ignore missing gitignore
  }
  return ig;
}
