#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { loadConfig } from "../config.js";
import { loadDotEnv } from "../config/dotenv.js";
import { createClient } from "../llm/factory.js";
import { estimateTokens } from "../llm/client.js";
import { createAgentState, worldStateSummary } from "../loop/state.js";
import { runTurn } from "../loop/agentLoop.js";
import { compact } from "../loop/compaction.js";
import type { SandboxContext } from "../tools/sandbox.js";
import { ansi, color } from "./ui.js";
import { TuiApp } from "./tui.js";
import { createInkUi } from "./inkUi.js";
import { renderMarkdownToPlain } from "./markdown.js";
import { execa } from "execa";
import { toolDefinitions } from "../tools/definitions.js";
import {
  applyStoredSession,
  defaultSessionsDir,
  listSessions,
  loadSession,
  newSessionId,
  saveSession,
  toStoredSession,
} from "../sessions/store.js";

const SYSTEM_PROMPT = `You are yoof1337, a terminal-based coding agent working inside a sandboxed project directory.
You have tools to read/write files, list directories, run shell commands, and search code. All paths are relative to the working directory; you cannot access anything outside it.
Work iteratively: inspect before you modify, run code to verify your changes, and react to tool errors (they are returned as tool results).
Mutating actions (write_file, run_command) may require user approval and can be denied -- if denied, adjust your approach rather than retrying the same call.
When the task is complete, reply with a concise final summary instead of calling more tools.`;

function buildSystemPrompt(providerName: string): string {
  if (providerName !== "llamacpp") return SYSTEM_PROMPT;
  const names = toolDefinitions().map((t) => t.name).sort();
  return (
    SYSTEM_PROMPT +
    `\n\nIMPORTANT TOOL-CALLING RULES (llama.cpp):\n` +
    `- You may ONLY request tools from this exact allowlist:\n` +
    `${names.map((n) => `  - ${n}`).join("\n")}\n` +
    `- Never invent tool names. If no tool fits, ask a clarifying question or respond normally.\n` +
    `- If you need to read a file, prefer read_file_excerpt for large files.\n` +
    `- After you get the needed tool result(s), stop calling tools and produce the final answer.`
  );
}

interface CliArgs {
  yolo: boolean;
  plain: boolean;
  legacyTui: boolean;
  docker: boolean;
  unsafeHost: boolean;
  dockerImage?: string;
  dir: string;
  provider?: string;
  configPath?: string;
  envPath?: string;
  sessionsDir?: string;
}

function parseArgs(argv: string[]): CliArgs {
  // Default to running run_command in Docker for isolation.
  const args: CliArgs = {
    yolo: false,
    plain: false,
    legacyTui: false,
    docker: true,
    unsafeHost: false,
    dir: process.cwd(),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yolo") args.yolo = true;
    else if (a === "--plain") args.plain = true;
    else if (a === "--legacy-tui") args.legacyTui = true;
    else if (a === "--docker") args.docker = true;
    else if (a === "--docker-image") args.dockerImage = argv[++i];
    else if (a === "--unsafe-host") args.unsafeHost = true;
    else if (a === "--dir") args.dir = path.resolve(argv[++i] ?? process.cwd());
    else if (a === "--provider") args.provider = argv[++i];
    else if (a === "--config") args.configPath = argv[++i];
    else if (a === "--env") args.envPath = argv[++i];
    else if (a === "--sessions-dir") args.sessionsDir = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`yoof1337 -- terminal coding agent

usage: yoof1337 [options]
  --dir <path>       working directory sandbox (default: cwd)
  --provider <name>  openai | llamacpp (default: from config.json)
  --config <path>    path to config.json
  --env <path>       .env file path (default: ./\.env)
  --sessions-dir <p> session store directory (default: user-local)
  --yolo             auto-approve all tool calls (mutating ones included)
  --plain            disable TUI (use basic readline)
  --legacy-tui       use the lightweight built-in TUI (non-Ink)
  --docker           run run_command inside docker (default)
  --docker-image <i> docker image to use (default: node:22)
  --unsafe-host      run run_command on the host (DANGEROUS)

in-session commands: /compact  /state  /help  /exit`);
      process.exit(0);
    }
  }
  return args;
}

async function runPlain(args: CliArgs, sandbox: SandboxContext): Promise<void> {
  const dotenv = loadDotEnv({ envPath: args.envPath });
  const config = loadConfig(args.configPath);
  const providerName = args.provider ?? config.provider;
  const client = createClient(config, args.provider);
  const state = createAgentState(buildSystemPrompt(providerName));
  state.sessionId = newSessionId();
  const sessionCreatedAt = new Date().toISOString();
  const sessionsDir = path.resolve(args.sessionsDir ?? defaultSessionsDir());

  const persist = async (): Promise<void> => {
    if (!state.sessionId) return;
    await saveSession(
      sessionsDir,
      toStoredSession(state, {
        id: state.sessionId,
        createdAt: sessionCreatedAt,
        provider: providerName,
        model: client.model,
        sandboxRoot: sandbox.root,
      })
    );
  };

  console.log(`yoof1337 -- model: ${client.model} | sandbox: ${sandbox.root}`);
  if (dotenv.loaded) console.log(color(`loaded env: ${dotenv.path}`, ansi.dim));
  console.log(color(`session: ${state.sessionId} (${sessionsDir})`, ansi.dim));
  if (args.yolo) console.log(color("! yolo mode: all tool calls auto-approved", ansi.yellow));
  console.log(color("type a task, or /help for commands\n", ansi.dim));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const io = { print: (t: string) => console.log(t), rl, format: renderMarkdownToPlain };

  async function cmdStatus(): Promise<void> {
    try {
      const res = await execa("git", ["status", "-sb", "--porcelain=v1"], { cwd: sandbox.root, windowsHide: true });
      console.log(res.stdout || "(clean)");
    } catch (err) {
      console.log(color(`git status failed: ${err instanceof Error ? err.message : String(err)}`, ansi.red));
    }
  }

  async function cmdDiff(): Promise<void> {
    try {
      const res = await execa("git", ["diff"], { cwd: sandbox.root, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
      console.log(res.stdout || "(no diff)");
    } catch (err) {
      console.log(color(`git diff failed: ${err instanceof Error ? err.message : String(err)}`, ansi.red));
    }
  }

  async function cmdGh(args: string[]): Promise<void> {
    const out = await runGh(args, sandbox.root);
    console.log(out);
  }

  async function cmdPrCreate(title: string): Promise<void> {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      console.log(color("usage: /pr create <title>", ansi.yellow));
      return;
    }
    const body = (await rl.question(color("Body (optional): ", ansi.bold))).toString();
    const draftAns = (await rl.question(color("Draft? [y/N] ", ansi.bold))).trim().toLowerCase();
    const draft = draftAns === "y" || draftAns === "yes";
    const args = ["pr", "create", "--title", cleanTitle, "--body", body ?? ""];
    if (draft) args.push("--draft");
    await cmdGh(args);
  }

  async function cmdPrComment(pr: string): Promise<void> {
    const id = pr.trim();
    if (!id) {
      console.log(color("usage: /pr comment <id>", ansi.yellow));
      return;
    }
    const body = (await rl.question(color("Comment body: ", ansi.bold))).toString();
    if (!body.trim()) {
      console.log(color("comment body is required", ansi.yellow));
      return;
    }
    await cmdGh(["pr", "comment", id, "--body", body]);
  }

  for (;;) {
    let line: string;
    try {
      line = (await rl.question(color("you> ", ansi.bold))).trim();
    } catch {
      break; // stdin closed
    }
    if (!line) continue;

    if (line === "/exit" || line === "/quit") break;
    if (line === "/help") {
      console.log(
        `${color("/compact", ansi.cyan)}  summarize and shrink the conversation history\n${color("/state", ansi.cyan)}    show tracked world state and token estimate\n${color("/sessions", ansi.cyan)} list saved sessions\n${color("/resume <id>", ansi.cyan)} resume a saved session\n${color("/save", ansi.cyan)}     save current session\n${color("/status", ansi.cyan)}   git status\n${color("/diff", ansi.cyan)}     git diff\n${color("/gh auth", ansi.cyan)}  show gh auth status\n${color("/pr view <id>", ansi.cyan)} view PR\n${color("/pr diff <id>", ansi.cyan)} diff PR\n${color("/pr create <title>", ansi.cyan)} create PR\n${color("/pr comment <id>", ansi.cyan)} comment PR\n${color("/exit", ansi.cyan)}     quit`
      );
      continue;
    }
    if (line === "/status") {
      await cmdStatus();
      continue;
    }
    if (line === "/diff") {
      await cmdDiff();
      continue;
    }
    if (line === "/gh auth") {
      await cmdGh(["auth", "status"]);
      continue;
    }
    if (line.startsWith("/pr view ")) {
      const pr = line.slice("/pr view ".length).trim();
      await cmdGh(["pr", "view", pr]);
      continue;
    }
    if (line.startsWith("/pr diff ")) {
      const pr = line.slice("/pr diff ".length).trim();
      await cmdGh(["pr", "diff", pr]);
      continue;
    }
    if (line.startsWith("/pr create ")) {
      const title = line.slice("/pr create ".length);
      await cmdPrCreate(title);
      continue;
    }
    if (line.startsWith("/pr comment ")) {
      const pr = line.slice("/pr comment ".length);
      await cmdPrComment(pr);
      continue;
    }
    if (line === "/sessions") {
      const sessions = await listSessions(sessionsDir);
      if (sessions.length === 0) console.log("(no saved sessions)");
      else for (const s of sessions) console.log(`${s.id}  ${s.updatedAt}  ${s.title}`);
      continue;
    }
    if (line.startsWith("/resume ")) {
      const id = line.slice("/resume ".length).trim();
      try {
        const stored = await loadSession(sessionsDir, id);
        applyStoredSession(state, stored);
        state.sessionId = stored.meta.id;
        console.log(color(`resumed session ${stored.meta.id}: ${stored.meta.title}`, ansi.green));
      } catch (err) {
        console.log(color(`resume failed: ${err instanceof Error ? err.message : String(err)}`, ansi.red));
      }
      continue;
    }
    if (line === "/save") {
      try {
        await persist();
        console.log(color("saved", ansi.green));
      } catch (err) {
        console.log(color(`save failed: ${err instanceof Error ? err.message : String(err)}`, ansi.red));
      }
      continue;
    }
    if (line === "/state") {
      console.log(worldStateSummary(state.world));
      console.log(
        `\n~${estimateTokens(state.messages)} tokens in history (compaction at ${Math.round(
          client.contextWindow * config.compaction.thresholdRatio
        )})`
      );
      continue;
    }
    if (line === "/compact") {
      console.log(color("compacting context...", ansi.dim));
      try {
        await compact(state, client, config.compaction);
        console.log(color(`done -- history is now ~${estimateTokens(state.messages)} tokens`, ansi.green));
      } catch (err) {
        console.log(color(`compaction failed: ${err instanceof Error ? err.message : String(err)}`, ansi.red));
      }
      continue;
    }

    await runTurn(state, line, client, config, sandbox, { yolo: args.yolo }, io);
    try {
      await persist();
    } catch {
      // ignore autosave failures
    }
  }

  rl.close();
  console.log(color("bye", ansi.dim));
}

async function runTui(args: CliArgs, sandbox: SandboxContext): Promise<void> {
  const dotenv = loadDotEnv({ envPath: args.envPath });
  const config = loadConfig(args.configPath);
  const providerName = args.provider ?? config.provider;
  const client = createClient(config, args.provider);
  const state = createAgentState(buildSystemPrompt(providerName));
  state.sessionId = newSessionId();
  const sessionCreatedAt = new Date().toISOString();
  const sessionsDir = path.resolve(args.sessionsDir ?? defaultSessionsDir());

  const app: {
    start: () => void;
    stop: () => void;
    println: (t: string) => void;
    setStatusline?: (t: string) => void;
    setTools?: (lines: string[]) => void;
    readLine: (promptLabel?: string) => Promise<string | null>;
    createQuestioner: () => any;
  } = (args.legacyTui
    ? new TuiApp({
        title: "yoof1337",
        subtitle: `model: ${client.model} | sandbox: ${sandbox.root}`,
      })
    : createInkUi({
        title: "yoof1337",
        subtitle: `model: ${client.model} | sandbox: ${sandbox.root}`,
      })) as any;
  app.start();
  const questioner = app.createQuestioner();
  const io = {
    print: (t: string) => app.println(t),
    rl: questioner,
    format: renderMarkdownToPlain,
    onToolStart: (name: string) => {
      toolPanel.push(`> ${name}`);
      app.setTools?.(toolPanel);
    },
    onToolEnd: (name: string, result: string, approved: boolean) => {
      const head = approved ? `✓ ${name}` : `✗ ${name}`;
      const firstLine = String(result ?? "").split(/\r?\n/, 1)[0] ?? "";
      toolPanel.push(`${head}: ${firstLine.slice(0, 60)}`);
      app.setTools?.(toolPanel);
    },
  };

  app.println(color("/help for commands • /exit to quit", ansi.dim));
  if (dotenv.loaded) app.println(color(`loaded env: ${dotenv.path}`, ansi.dim));
  app.println(color(`session: ${state.sessionId} (${sessionsDir})`, ansi.dim));
  if (args.yolo) app.println(color("! yolo mode: all tool calls auto-approved", ansi.yellow));

  const toolPanel: string[] = [];

  async function refreshStatusline(): Promise<void> {
    const tokenEstimate = estimateTokens(state.messages);
    const git = await getGitStatusLine(sandbox.root);
    const exec = sandbox.execMode === "docker" ? "docker" : "host";
    const approval = args.yolo ? "yolo" : "prompt";
    app.setStatusline?.(`exec:${exec} approvals:${approval} tokens:~${tokenEstimate} ${git}`.trim());
  }
  await refreshStatusline();

  const persist = async (): Promise<void> => {
    if (!state.sessionId) return;
    await saveSession(
      sessionsDir,
      toStoredSession(state, {
        id: state.sessionId,
        createdAt: sessionCreatedAt,
        provider: providerName,
        model: client.model,
        sandboxRoot: sandbox.root,
      })
    );
  };

  async function cmdStatus(): Promise<void> {
    try {
      const res = await execa("git", ["status", "-sb", "--porcelain=v1"], { cwd: sandbox.root, windowsHide: true });
      app.println(res.stdout || "(clean)");
    } catch (err) {
      app.println(color(`git status failed: ${err instanceof Error ? err.message : String(err)}`, ansi.red));
    }
  }

  async function cmdDiff(): Promise<void> {
    try {
      const res = await execa("git", ["diff"], { cwd: sandbox.root, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
      app.println(res.stdout || "(no diff)");
    } catch (err) {
      app.println(color(`git diff failed: ${err instanceof Error ? err.message : String(err)}`, ansi.red));
    }
  }

  async function cmdGh(args: string[]): Promise<void> {
    const out = await runGh(args, sandbox.root);
    app.println(out);
  }

  async function cmdPrCreate(title: string): Promise<void> {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      app.println(color("usage: /pr create <title>", ansi.yellow));
      return;
    }
    const body = (await questioner.question("Body (optional): ")).toString();
    const draftAns = (await questioner.question("Draft? [y/N] ")).trim().toLowerCase();
    const draft = draftAns === "y" || draftAns === "yes";
    const args = ["pr", "create", "--title", cleanTitle, "--body", body ?? ""];
    if (draft) args.push("--draft");
    await cmdGh(args);
  }

  async function cmdPrComment(pr: string): Promise<void> {
    const id = pr.trim();
    if (!id) {
      app.println(color("usage: /pr comment <id>", ansi.yellow));
      return;
    }
    const body = (await questioner.question("Comment body: ")).toString();
    if (!body.trim()) {
      app.println(color("comment body is required", ansi.yellow));
      return;
    }
    await cmdGh(["pr", "comment", id, "--body", body]);
  }

  try {
    for (;;) {
      await refreshStatusline();
      const line = await app.readLine();
      if (line === null) break;
      if (!line) continue;

      if (!args.legacyTui) {
        app.println(`${color("you>", ansi.gray)} ${line}`);
      }

      if (line === "/exit" || line === "/quit") break;
      if (line === "/help") {
        app.println(`${color("/compact", ansi.cyan)}  summarize and shrink the conversation history`);
        app.println(`${color("/state", ansi.cyan)}    show tracked world state and token estimate`);
        app.println(`${color("/sessions", ansi.cyan)} list saved sessions`);
        app.println(`${color("/resume <id>", ansi.cyan)} resume a saved session`);
        app.println(`${color("/save", ansi.cyan)}     save current session`);
        app.println(`${color("/status", ansi.cyan)}   git status`);
        app.println(`${color("/diff", ansi.cyan)}     git diff`);
        app.println(`${color("/gh auth", ansi.cyan)}  show gh auth status`);
        app.println(`${color("/pr view <id>", ansi.cyan)} view PR`);
        app.println(`${color("/pr diff <id>", ansi.cyan)} diff PR`);
        app.println(`${color("/pr create <title>", ansi.cyan)} create PR`);
        app.println(`${color("/pr comment <id>", ansi.cyan)} comment PR`);
        app.println(`${color("/exit", ansi.cyan)}     quit`);
        continue;
      }
      if (line === "/status") {
        await cmdStatus();
        continue;
      }
      if (line === "/diff") {
        await cmdDiff();
        continue;
      }
      if (line === "/gh auth") {
        await cmdGh(["auth", "status"]);
        continue;
      }
      if (line.startsWith("/pr view ")) {
        const pr = line.slice("/pr view ".length).trim();
        await cmdGh(["pr", "view", pr]);
        continue;
      }
      if (line.startsWith("/pr diff ")) {
        const pr = line.slice("/pr diff ".length).trim();
        await cmdGh(["pr", "diff", pr]);
        continue;
      }
      if (line.startsWith("/pr create ")) {
        const title = line.slice("/pr create ".length);
        await cmdPrCreate(title);
        continue;
      }
      if (line.startsWith("/pr comment ")) {
        const pr = line.slice("/pr comment ".length);
        await cmdPrComment(pr);
        continue;
      }
      if (line === "/sessions") {
        const sessions = await listSessions(sessionsDir);
        if (sessions.length === 0) app.println("(no saved sessions)");
        else for (const s of sessions) app.println(`${s.id}  ${s.updatedAt}  ${s.title}`);
        continue;
      }
      if (line.startsWith("/resume ")) {
        const id = line.slice("/resume ".length).trim();
        try {
          const stored = await loadSession(sessionsDir, id);
          applyStoredSession(state, stored);
          state.sessionId = stored.meta.id;
          app.println(color(`resumed session ${stored.meta.id}: ${stored.meta.title}`, ansi.green));
        } catch (err) {
          app.println(color(`resume failed: ${err instanceof Error ? err.message : String(err)}`, ansi.red));
        }
        continue;
      }
      if (line === "/save") {
        try {
          await persist();
          app.println(color("saved", ansi.green));
        } catch (err) {
          app.println(color(`save failed: ${err instanceof Error ? err.message : String(err)}`, ansi.red));
        }
        continue;
      }
      if (line === "/state") {
        app.println(worldStateSummary(state.world));
        app.println(
          `~${estimateTokens(state.messages)} tokens in history (compaction at ${Math.round(
            client.contextWindow * config.compaction.thresholdRatio
          )})`
        );
        continue;
      }
      if (line === "/compact") {
        app.println(color("compacting context...", ansi.dim));
        try {
          await compact(state, client, config.compaction);
          app.println(color(`done -- history is now ~${estimateTokens(state.messages)} tokens`, ansi.green));
        } catch (err) {
          app.println(color(`compaction failed: ${err instanceof Error ? err.message : String(err)}`, ansi.red));
        }
        continue;
      }

      await runTurn(state, line, client, config, sandbox, { yolo: args.yolo }, io);
      try {
        await persist();
      } catch {
        // ignore autosave failures
      }
      await refreshStatusline();
    }
  } finally {
    app.stop();
  }
}

async function getGitStatusLine(cwd: string): Promise<string> {
  try {
    const branch = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, windowsHide: true, reject: false });
    if (branch.exitCode !== 0) return "";
    const status = await execa("git", ["status", "--porcelain=v1"], { cwd, windowsHide: true, reject: false });
    const dirty = (status.stdout ?? "").trim().length > 0;
    return `git:${branch.stdout.trim()}${dirty ? "*" : ""}`;
  } catch {
    return "";
  }
}

async function runGh(args: string[], cwd: string): Promise<string> {
  try {
    const res = await execa("gh", args, { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024, reject: false });
    if (res.exitCode !== 0) return res.stderr || res.stdout || "(gh failed)";
    return res.stdout || "(ok)";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `gh error: ${msg}`;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.unsafeHost) {
    args.docker = false;
  }
  const sandbox: SandboxContext = {
    root: args.dir,
    commandTimeoutMs: loadConfig(args.configPath).commandTimeoutMs,
    execMode: args.docker ? "docker" : "host",
    dockerImage: args.dockerImage,
  };

  if (sandbox.execMode === "host") {
    console.log(
      color(
        "WARNING: --unsafe-host enabled. run_command will execute on your host machine, not in Docker.",
        ansi.yellow
      )
    );
  }

  const wantTui = !args.plain && process.stdout.isTTY && process.stdin.isTTY;
  if (wantTui) return runTui(args, sandbox);
  return runPlain(args, sandbox);
}

main().catch((err) => {
  console.error(color(err instanceof Error ? err.message : String(err), ansi.red));
  process.exit(1);
});
