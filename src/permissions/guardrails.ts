import { TOOLS } from "../tools/definitions.js";
import { ansi, color, formatBox } from "../cli/ui.js";

export interface PermissionOptions {
  /** Explicit opt-in: auto-approve everything, including mutating tools. Off by default. */
  yolo: boolean;
}

export type PermissionDecision = { approved: true } | { approved: false; reason: string };

type Questioner = {
  question: (prompt: string) => Promise<string>;
  close?: () => void;
  isTui?: boolean;
};

/**
 * Auto-approved: read_file, list_directory, search_code (read-only).
 * Requires confirmation: write_file, run_command, anything mutating.
 * The prompt shows the user exactly what will run/change before executing.
 */
export async function requestPermission(
  toolName: string,
  input: Record<string, unknown>,
  opts: PermissionOptions,
  rl?: Questioner
): Promise<PermissionDecision> {
  const tool = TOOLS[toolName];
  // Unknown tools fall through to the executor, which reports the error to the model.
  if (!tool || !tool.mutating) return { approved: true };
  if (opts.yolo) return { approved: true };

  const box = formatBox(color("permission required", ansi.bold, ansi.yellow), [
    `${color("tool:", ansi.gray)} ${color(toolName, ansi.cyan)}`,
    ...describe(toolName, input).map((l) => `${color(">", ansi.gray)} ${l}`),
  ]);

  const ownRl: Questioner =
    rl ?? (await import("node:readline/promises")).default.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = `${box}\n${color("Approve? [y/N] ", ansi.bold)}`;
  if (!ownRl.isTui) console.log(`\n${box}\n`);

  try {
    const answer = (await ownRl.question(ownRl.isTui ? prompt : color("Approve? [y/N] ", ansi.bold))).trim().toLowerCase();
    if (answer === "y" || answer === "yes") return { approved: true };
    return { approved: false, reason: "User denied permission for this action." };
  } finally {
    if (!rl && ownRl.close) ownRl.close();
  }
}

function describe(toolName: string, input: Record<string, unknown>): string[] {
  if (toolName === "run_command") {
    return [`command: ${String(input.command ?? "")}`];
  }
  if (toolName === "write_file") {
    const content = String(input.content ?? "");
    const lines = content.split("\n");
    const preview = lines.slice(0, 20).map((l) => `  ${l}`);
    if (lines.length > 20) preview.push(`  ... (${lines.length - 20} more lines)`);
    return [
      `file: ${String(input.path ?? "")}`,
      `content (${Buffer.byteLength(content, "utf8")} bytes):`,
      ...preview,
    ];
  }
  if (toolName === "apply_patch") {
    const patch = String(input.patch ?? "");
    const lines = patch.split("\n");
    const preview = lines.slice(0, 60).map((l) => `  ${l}`);
    if (lines.length > 60) preview.push(`  ... (${lines.length - 60} more lines)`);
    return [`patch (${Buffer.byteLength(patch, "utf8")} bytes):`, ...preview];
  }
  return [`input: ${JSON.stringify(input)}`];
}
