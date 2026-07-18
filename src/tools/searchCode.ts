import fs from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";
import { resolveInSandbox, type SandboxContext } from "./sandbox.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv", "venv"]);
const MAX_MATCHES = 200;
const MAX_FILE_BYTES = 1024 * 1024;

/**
 * Grep-like recursive search. Pure Node implementation so it works the same
 * on Windows and Linux with no external grep/ripgrep dependency.
 * Respects .gitignore at the sandbox root.
 */
export async function searchCode(input: { query: string; path?: string }, ctx: SandboxContext): Promise<string> {
  const start = resolveInSandbox(ctx, input.path ?? ".");
  const ig = await loadGitignore(ctx.root);

  let regex: RegExp;
  try {
    regex = new RegExp(input.query, "i");
  } catch {
    // Not valid regex -- fall back to literal search.
    regex = new RegExp(input.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }

  const matches: string[] = [];
  await walk(start, regex, ctx, matches, ig);
  if (matches.length === 0) return `No matches for "${input.query}".`;
  const capped = matches.slice(0, MAX_MATCHES);
  const suffix = matches.length > MAX_MATCHES ? `\n[showing first ${MAX_MATCHES} of ${matches.length} matches]` : "";
  return capped.join("\n") + suffix;
}

async function loadGitignore(root: string) {
  const ig = ignore();
  try {
    const raw = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    ig.add(raw.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#")));
  } catch {
    // ignore
  }
  return ig;
}

async function walk(
  dir: string,
  regex: RegExp,
  ctx: SandboxContext,
  matches: string[],
  ig: ReturnType<typeof ignore>
): Promise<void> {
  if (matches.length > MAX_MATCHES) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (matches.length > MAX_MATCHES) return;
    const full = path.join(dir, entry.name);
    const rel = path.relative(ctx.root, full).replace(/\\/g, "/");
    if (ig.ignores(rel)) continue;

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(full, regex, ctx, matches, ig);
    } else if (entry.isFile()) {
      try {
        const stat = await fs.stat(full);
        if (stat.size > MAX_FILE_BYTES) continue;
        const content = await fs.readFile(full, "utf8");
        if (content.includes(String.fromCharCode(0))) continue; // binary
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            matches.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
            if (matches.length > MAX_MATCHES) return;
          }
        }
      } catch {
        // unreadable file -- skip
      }
    }
  }
}
