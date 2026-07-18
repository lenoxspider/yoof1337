import fs from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";
import { resolveInSandbox, type SandboxContext } from "./sandbox.js";

const DEFAULT_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv", "venv"]);
const MAX_RESULTS = 2000;

export async function globFiles(
  input: { pattern: string; path?: string; includeDirs?: boolean },
  ctx: SandboxContext
): Promise<string> {
  const pattern = String(input.pattern ?? "").trim();
  if (!pattern) return "Error: pattern is required.";
  const start = resolveInSandbox(ctx, input.path ?? ".");
  const ig = await loadGitignore(ctx.root);

  const results: string[] = [];
  await walk(start, ctx.root, ig, patternToRegex(pattern), Boolean(input.includeDirs), results);
  if (results.length === 0) return "(no matches)";
  const capped = results.slice(0, MAX_RESULTS);
  const suffix = results.length > MAX_RESULTS ? `\n[showing first ${MAX_RESULTS} of ${results.length}]` : "";
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
  dirAbs: string,
  rootAbs: string,
  ig: ReturnType<typeof ignore>,
  re: RegExp,
  includeDirs: boolean,
  out: string[]
): Promise<void> {
  if (out.length > MAX_RESULTS) return;
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length > MAX_RESULTS) return;
    const full = path.join(dirAbs, e.name);
    const rel = path.relative(rootAbs, full).replace(/\\/g, "/");
    if (ig.ignores(rel)) continue;

    if (e.isDirectory()) {
      if (DEFAULT_SKIP_DIRS.has(e.name)) continue;
      if (includeDirs && re.test(rel)) out.push(rel);
      await walk(full, rootAbs, ig, re, includeDirs, out);
    } else if (e.isFile()) {
      if (re.test(rel)) out.push(rel);
    }
  }
}

function patternToRegex(pattern: string): RegExp {
  // Basic glob: **, *, ?, path separators.
  // - ** matches any chars including /
  // - * matches within a segment (no /)
  // - ? matches one char within a segment (no /)
  const esc = (s: string) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  let rx = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    const next = pattern[i + 1];
    if (c === "*" && next === "*") {
      rx += ".*";
      i++;
      continue;
    }
    if (c === "*") {
      rx += "[^/]*";
      continue;
    }
    if (c === "?") {
      rx += "[^/]";
      continue;
    }
    rx += esc(c);
  }
  return new RegExp("^" + rx + "$", "i");
}

