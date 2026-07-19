import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";

export type ProcessRecord = {
  id: string;
  command: string;
  startedAt: string;
  exitedAt: string | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  proc: ChildProcessWithoutNullStreams;
  timeout?: NodeJS.Timeout;
};

const MAX_BUF = 256 * 1024;

const store = new Map<string, ProcessRecord>();

export function startBackgroundCommand(opts: {
  command: string;
  cwd: string;
  timeoutMs: number;
}): ProcessRecord {
  const id = crypto.randomBytes(8).toString("hex");
  const startedAt = new Date().toISOString();

  const proc = spawn(opts.command, {
    cwd: opts.cwd,
    windowsHide: true,
    shell: true,
    stdio: "pipe",
  });

  const rec: ProcessRecord = {
    id,
    command: opts.command,
    startedAt,
    exitedAt: null,
    exitCode: null,
    signal: null,
    timedOut: false,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    proc,
  };

  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");

  proc.stdout.on("data", (chunk: string) => append(rec, "stdout", chunk));
  proc.stderr.on("data", (chunk: string) => append(rec, "stderr", chunk));

  proc.on("exit", (code, signal) => {
    rec.exitCode = typeof code === "number" ? code : null;
    rec.signal = (signal as NodeJS.Signals | null) ?? null;
    rec.exitedAt = new Date().toISOString();
    if (rec.timeout) clearTimeout(rec.timeout);
  });

  rec.timeout = setTimeout(() => {
    if (rec.exitedAt) return;
    rec.timedOut = true;
    try {
      proc.kill("SIGKILL");
    } catch {
      // ignore
    }
  }, opts.timeoutMs);

  store.set(id, rec);
  return rec;
}

export function getProcess(id: string): ProcessRecord | null {
  return store.get(id) ?? null;
}

export function killProcess(id: string): boolean {
  const rec = store.get(id);
  if (!rec) return false;
  if (rec.exitedAt) return true;
  try {
    rec.proc.kill("SIGKILL");
    return true;
  } catch {
    return false;
  }
}

export function pruneExited(keepLast: number = 50): void {
  const exited = [...store.values()].filter((r) => r.exitedAt !== null);
  exited.sort((a, b) => (b.exitedAt ?? "").localeCompare(a.exitedAt ?? ""));
  for (const r of exited.slice(keepLast)) store.delete(r.id);
}

function append(rec: ProcessRecord, which: "stdout" | "stderr", chunk: string): void {
  const key = which;
  const truncKey = which === "stdout" ? "stdoutTruncated" : "stderrTruncated";
  if ((rec as any)[truncKey]) return;

  const cur = (rec as any)[key] as string;
  const next = cur + chunk;
  if (Buffer.byteLength(next, "utf8") > MAX_BUF) {
    (rec as any)[key] = cur + "\n[truncated]\n";
    (rec as any)[truncKey] = true;
  } else {
    (rec as any)[key] = next;
  }
}

