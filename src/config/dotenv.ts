import fs from "node:fs";
import path from "node:path";

export type DotenvOptions = {
  /** Defaults to `${process.cwd()}/.env`. */
  envPath?: string;
  /** Defaults to false: do not override existing process.env values. */
  override?: boolean;
};

/**
 * Tiny .env loader (no external deps).
 * - Supports: KEY=VALUE, quotes, comments, blank lines.
 * - Does not do variable expansion.
 */
export function loadDotEnv(opts: DotenvOptions = {}): { loaded: boolean; path: string } {
  const envPath = opts.envPath ? path.resolve(opts.envPath) : path.resolve(process.cwd(), ".env");
  const override = opts.override ?? false;

  if (!fs.existsSync(envPath)) return { loaded: false, path: envPath };
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (!override && process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
  return { loaded: true, path: envPath };
}

