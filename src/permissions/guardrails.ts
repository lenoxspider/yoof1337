import { registry } from "../tools/registry.js";
import { ansi, color, formatBox } from "../cli/ui.js";
import { execa } from "execa";
import _Ajv from "ajv";

const Ajv = (_Ajv as unknown as { default: typeof _Ajv }).default || _Ajv;
const ajv = new (Ajv as any)();

export interface PermissionOptions {
  /** Explicit opt-in: auto-approve everything, including mutating tools. Off by default. */
  yolo: boolean;
  hooks?: Record<string, string>;
  rules?: {
    alwaysAllow: string[];
    alwaysDeny: string[];
    alwaysAsk: string[];
    allowedDomains?: string[];
  };
}

export type PermissionDecision = { approved: true; input?: Record<string, unknown> } | { approved: false; reason: string };

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
  const tool = registry.get(toolName);
  if (!tool || !tool.mutating) return { approved: true, input };

  // Stage 1: validateInput()
  try {
    const validate = ajv.compile(tool.definition.inputSchema);
    if (!validate(input)) {
      return { approved: false, reason: `Input validation failed: ${ajv.errorsText(validate.errors)}` };
    }
  } catch (e) {
    // If schema compilation fails, we can fallback, but ideally ajv catches it.
  }

  // Stage 2: PreToolUse Hooks
  let finalInput = { ...input };
  if (opts.hooks && opts.hooks[toolName]) {
    const hookCmd = opts.hooks[toolName];
    try {
      const hookResult = await execa(hookCmd, [], { input: JSON.stringify(finalInput), shell: true, reject: false });
      if (hookResult.exitCode !== 0) {
        return { approved: false, reason: `Hook denied: ${hookResult.stderr || hookResult.stdout}`.trim() };
      }
      if (hookResult.stdout.trim()) {
        try {
          const modified = JSON.parse(hookResult.stdout);
          if (typeof modified === "object" && modified !== null) {
            finalInput = modified;
          }
        } catch (e) {
          // stdout was not valid JSON, ignore
        }
      }
    } catch (e) {
      return { approved: false, reason: `Hook error: ${e}` };
    }
  }

  // Stage 3: Permission Rules
  if (opts.yolo) return { approved: true, input: finalInput };
  
  if (opts.rules) {
    if (opts.rules.alwaysDeny.includes(toolName)) {
      return { approved: false, reason: `Tool explicitly denied by rules.` };
    }
    
    let isAllowed = opts.rules.alwaysAllow.includes("*") || opts.rules.alwaysAllow.includes(toolName);
    
    if (isCommandTool(toolName) && typeof finalInput.command === "string") {
      const prefix = commandSimilarityPrefix(finalInput.command);
      if (prefix && opts.rules.alwaysAllow.some(rule => rule === prefix || rule.startsWith(prefix))) {
        isAllowed = true;
      }
    }

    if (toolName === "web_fetch" && typeof finalInput.url === "string") {
      try {
        const urlObj = new URL(finalInput.url);
        if (opts.rules.allowedDomains && opts.rules.allowedDomains.some(d => urlObj.hostname === d || urlObj.hostname.endsWith(`.${d}`))) {
          isAllowed = true;
        }
      } catch {
        // Invalid URL
      }
    }
    
    if (isAllowed) return { approved: true, input: finalInput };
  }

  // Stage 4: Interactive Prompt
  const box = formatBox(color("permission required", ansi.bold, ansi.yellow), [
    `${color("tool:", ansi.gray)} ${color(toolName, ansi.cyan)}`,
    ...describe(toolName, finalInput).map((l) => `${color(">", ansi.gray)} ${l}`),
  ]);

  const ownRl: Questioner =
    rl ?? (await import("node:readline/promises")).default.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = `${box}\n${color("Approve? [1] Allow Once / [2] Allow Always / [3] Deny: ", ansi.bold)}`;
  if (!ownRl.isTui) console.log(`\n${box}\n`);

  try {
    const answer = (await ownRl.question(ownRl.isTui ? prompt : color("Approve? [1] Allow Once / [2] Allow Always / [3] Deny: ", ansi.bold)))
      .trim()
      .toLowerCase();
      
    if (answer === "1" || answer === "allow once" || answer === "y") return { approved: true, input: finalInput };
    if (answer === "2" || answer === "allow always" || answer === "a") {
      if (opts.rules) {
        if (!opts.rules.alwaysAllow.includes(toolName)) {
          opts.rules.alwaysAllow.push(toolName);
        }
        if (isCommandTool(toolName) && typeof finalInput.command === "string") {
          const prefix = commandSimilarityPrefix(finalInput.command);
          if (prefix && !opts.rules.alwaysAllow.includes(prefix)) {
            opts.rules.alwaysAllow.push(prefix);
            if (!ownRl.isTui) console.log(color(`Always allowing similar commands: ${prefix}`, ansi.yellow));
          }
        }
      }
      return { approved: true, input: finalInput };
    }
    return { approved: false, reason: "User denied permission for this action." };
  } finally {
    if (!rl && ownRl.close) ownRl.close();
  }
}

function describe(toolName: string, input: Record<string, unknown>): string[] {
  if (toolName === "run_command") {
    return [`command: ${String(input.command ?? "")}`];
  }
  if (toolName === "run_command_bg") {
    return [`command: ${String(input.command ?? "")}`, "mode: background"];
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

function isCommandTool(toolName: string): boolean {
  return toolName === "run_command" || toolName === "run_command_bg";
}

function commandSimilarityPrefix(command: string): string | null {
  const tokens = tokenize(command);
  if (tokens.length === 0) return null;
  const t0 = tokens[0].toLowerCase();
  // For common multi-subcommand CLIs, include subcommand as part of the prefix.
  const multi = new Set(["git", "npm", "pnpm", "yarn", "cargo", "pip", "pip3", "python", "python3", "node"]);
  if (multi.has(t0) && tokens.length >= 2) return `${t0} ${tokens[1].toLowerCase()}`;
  return t0;
}

function tokenize(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
