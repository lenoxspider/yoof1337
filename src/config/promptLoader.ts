import fs from "node:fs/promises";
import path from "node:path";

const CANDIDATE_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".cursorrules",
  ".yoof1337/system_prompt.md",
  ".yoof1337/prompt.md",
  "PROMPT.md",
];

export interface LoadedInstructions {
  filename: string;
  filepath: string;
  content: string;
}

/**
 * Scan the workspace root for custom instruction files (AGENTS.md, CLAUDE.md, .cursorrules, etc.)
 */
export async function loadWorkspaceInstructions(root: string): Promise<LoadedInstructions | null> {
  for (const rel of CANDIDATE_FILES) {
    const fullPath = path.join(root, rel);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isFile()) {
        const raw = await fs.readFile(fullPath, "utf-8");
        const content = raw.trim();
        if (content) {
          return {
            filename: rel,
            filepath: fullPath,
            content,
          };
        }
      }
    } catch {
      // File does not exist, continue checking next candidate
    }
  }
  return null;
}
