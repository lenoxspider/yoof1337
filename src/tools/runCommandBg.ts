import type { SandboxContext } from "./sandbox.js";
import { checkDenylist } from "./runCommand.js";
import { startBackgroundCommand } from "./processStore.js";

export async function runCommandBg(input: { command: string }, ctx: SandboxContext): Promise<string> {
  const denied = checkDenylist(input.command);
  if (denied) return `Error: command blocked by safety denylist (${denied}). It was not executed.`;

  if ((ctx.execMode ?? "host") !== "host") {
    return `Error: run_command_bg is only supported in host exec mode right now. Start the agent with --unsafe-host if you really need background commands.`;
  }

  const rec = startBackgroundCommand({ command: input.command, cwd: ctx.root, timeoutMs: ctx.commandTimeoutMs });
  return `Started command ${rec.id}\ncommand: ${rec.command}\nstartedAt: ${rec.startedAt}`;
}

