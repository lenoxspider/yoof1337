import { execa, execaCommand } from "execa";
import type { SandboxContext } from "./sandbox.js";

const MAX_OUTPUT = 64 * 1024;

/**
 * First-line-of-defense denylist for obviously destructive commands.
 * This is a safety net on top of the permission system (run_command always
 * requires user confirmation unless yolo mode is on) and the cwd sandbox --
 * NOT a substitute for either. For stronger isolation, run the whole agent
 * inside a container (see README).
 */
const DENYLIST: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\s+([\/~]|\\\\|[a-z]:)/i,
    reason: "recursive force-delete of a root/home path",
  },
  { pattern: /:\(\)\s*\{\s*:\|\s*:\s*&\s*\}\s*;\s*:/, reason: "fork bomb" },
  { pattern: /mkfs(\.| )/i, reason: "filesystem format" },
  { pattern: /dd\s+.*of=\/dev\//i, reason: "raw write to a device" },
  { pattern: />\s*\/dev\/sd[a-z]/i, reason: "raw write to a device" },
  { pattern: /\bformat\s+[a-z]:/i, reason: "drive format" },
  { pattern: /shutdown|reboot\b/i, reason: "system shutdown/reboot" },
];

export function checkDenylist(command: string): string | null {
  for (const { pattern, reason } of DENYLIST) {
    if (pattern.test(command)) return reason;
  }
  return null;
}

export async function runCommand(input: { command: string }, ctx: SandboxContext): Promise<string> {
  const denied = checkDenylist(input.command);
  if (denied) {
    return `Error: command blocked by safety denylist (${denied}). It was not executed.`;
  }

  const execMode = ctx.execMode ?? "host";

  try {
    if (execMode === "docker") {
      const image = ctx.dockerImage ?? "node:22";
      const res = await execa(
        "docker",
        ["run", "--rm", "-v", `${ctx.root}:/work`, "-w", "/work", image, "bash", "-lc", input.command],
        {
          cwd: ctx.root,
          timeout: ctx.commandTimeoutMs,
          windowsHide: true,
          maxBuffer: 8 * 1024 * 1024,
          reject: false,
        }
      );
      return formatResult(res.exitCode ?? 0, Boolean(res.timedOut), res.stdout, res.stderr, ctx.commandTimeoutMs);
    }

    const res = await execaCommand(input.command, {
      cwd: ctx.root,
      timeout: ctx.commandTimeoutMs,
      windowsHide: true,
      shell: true,
      maxBuffer: 8 * 1024 * 1024,
      reject: false,
    });

    return formatResult(res.exitCode ?? 0, Boolean(res.timedOut), res.stdout, res.stderr, ctx.commandTimeoutMs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error: failed to run command: ${msg}`;
  }
}

function formatResult(
  exitCode: number,
  timedOut: boolean,
  stdout: string,
  stderr: string,
  timeoutMs: number
): string {
  // If execa reports a timeout, treat it as a failure even if exitCode is null/0.
  const effectiveExit = timedOut ? 124 : exitCode;
  const parts = [
    `exit code: ${effectiveExit}${timedOut ? ` (killed: timeout after ${timeoutMs}ms)` : ""}`,
    `stdout:\n${truncate(stdout)}`,
    `stderr:\n${truncate(stderr)}`,
  ];
  return parts.join("\n");
}

function truncate(s: string): string {
  if (s.length <= MAX_OUTPUT) return s || "(empty)";
  return s.slice(0, MAX_OUTPUT) + `\n[truncated: ${s.length} chars total]`;
}
