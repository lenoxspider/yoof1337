import path from "node:path";

/**
 * All tool executors receive this context. Every file path and command is
 * scoped to `root`; nothing outside it is reachable by default.
 */
export interface SandboxContext {
  root: string;
  commandTimeoutMs: number;
  /** Execute commands on host or via docker. */
  execMode?: "host" | "docker";
  /** Docker image to use when execMode=docker. */
  dockerImage?: string;
}

export class SandboxViolationError extends Error {}

/**
 * Resolve a model-supplied path against the sandbox root and reject anything
 * that escapes it (absolute paths outside root, `..` traversal, drive hops).
 * Comparison is case-insensitive on Windows.
 */
export function resolveInSandbox(ctx: SandboxContext, requested: string): string {
  const resolved = path.resolve(ctx.root, requested);
  const normalize = (p: string) =>
    process.platform === "win32" ? p.toLowerCase() : p;
  const root = normalize(path.resolve(ctx.root));
  const target = normalize(resolved);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new SandboxViolationError(
      `Path "${requested}" resolves outside the working directory sandbox (${ctx.root}).`
    );
  }
  return resolved;
}
