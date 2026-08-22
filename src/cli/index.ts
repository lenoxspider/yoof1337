#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { loadConfig } from "../config.js";
import { loadDotEnv } from "../config/dotenv.js";
import { createClient } from "../llm/factory.js";
import { estimateTokens } from "../llm/client.js";
import { createAgentState, worldStateSummary, AgentState } from "../loop/state.js";
import { runTurn } from "../loop/agentLoop.js";
import type { TurnProgress } from "../loop/agentLoop.js";
import { compact } from "../loop/compaction.js";
import type { SandboxContext } from "../tools/sandbox.js";
import { ansi, color } from "./ui.js";
import { createInkUi } from "./inkUi.js";
import { renderMarkdownToPlain } from "./markdown.js";
import { progressDetail, turnSummary, formatTokens } from "./format.js";

import { hintForToolResult } from "./hints.js";
import { execa } from "execa";
import { toolDefinitions, resetToolsToCore } from "../tools/definitions.js";
import { taskStore } from "../tasks/taskStore.js";
import { registry } from "../tools/registry.js";
import { treeDirectory } from "../tools/treeDirectory.js";
import { loadCustomTools } from "../tools/dynamicTools.js";
import { loadWorkspaceInstructions, type LoadedInstructions } from "../config/promptLoader.js";
import { expandFileTags } from "./fileTagger.js";
import {
  applyStoredSession,
  defaultSessionsDir,
  listSessions,
  loadSession,
  newSessionId,
  toStoredSession,
} from "../sessions/store.js";

const SYSTEM_PROMPT = `You are yoof1337, a terminal-based coding agent working inside a sandboxed project directory.
You have tools to read/write files, list directories, run shell commands, and search code. All paths are relative to the working directory; you cannot access anything outside it.
Work iteratively: inspect before you modify, run code to verify your changes, and react to tool errors (they are returned as tool results).
Mutating actions (write_file, run_command) may require user approval and can be denied -- if denied, adjust your approach rather than retrying the same call.

MULTI-AGENT ORCHESTRATION:
You can delegate work to background sub-agents using the task and agent tools:
- agent_run: Spawn a sub-agent with a custom system prompt to work on a task asynchronously.
- task_create: Create a task and optionally assign it to a named team.
- task_get / task_list / task_output: Monitor progress of background tasks.
- task_stop: Cancel a running task.
- team_create / team_delete: Create specialized teams (e.g. "frontend", "testing") with shared system prompts.
- send_message: Send a message to another agent by task ID.
For complex multi-step projects, consider breaking work into parallel tasks assigned to specialized sub-agents.

When the task is complete, reply with a concise final summary instead of calling more tools.`;

function buildSystemPrompt(providerName: string, customInstructions?: LoadedInstructions | null): string {
  let prompt = SYSTEM_PROMPT;

  if (customInstructions) {
    prompt += `\n\n## CUSTOM REPOSITORY INSTRUCTIONS (Loaded from ${customInstructions.filename}):\n${customInstructions.content}\n`;
  }

  if (providerName === "llamacpp") {
    const names = toolDefinitions().map((t) => t.name).sort();
    prompt +=
      `\n\nIMPORTANT TOOL-CALLING RULES (llama.cpp):\n` +
      `- You may ONLY request tools from this exact allowlist:\n` +
      `${names.map((n) => `  - ${n}`).join("\n")}\n` +
      `- Never invent tool names. If no tool fits, ask a clarifying question or respond normally.\n` +
      `- If you need to read a file, prefer read_file_excerpt for large files.\n` +
      `- After you get the needed tool result(s), stop calling tools and produce the final answer.`;
  }

  return prompt;
}

interface CliArgs {
  yolo: boolean;
  tui: boolean;
  plain: boolean;
  docker: boolean;
  unsafeHost: boolean;
  dockerImage?: string;
  dir: string;
  provider?: string;
  configPath?: string;
  envPath?: string;
  sessionsDir?: string;
  continue: boolean;
  resume?: string;
  forkSession: boolean;
  askForApproval: "untrusted" | "on-request" | "never";
}

function parseArgs(argv: string[]): CliArgs {
  // Default to running run_command on the host (normal terminal behavior).
  const args: CliArgs = {
    yolo: false,
    tui: false,
    plain: false,
    docker: false,
    unsafeHost: false,
    dir: process.cwd(),
    continue: false,
    forkSession: false,
    askForApproval: "on-request",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yolo") args.yolo = true;
    else if (a === "--tui") args.tui = true;
    else if (a === "--plain") args.plain = true;
    else if (a === "--docker") args.docker = true;
    else if (a === "--docker-image") args.dockerImage = argv[++i];
    else if (a === "--unsafe-host") args.unsafeHost = true;
    else if (a === "--dir") args.dir = path.resolve(argv[++i] ?? process.cwd());
    else if (a === "--provider") args.provider = argv[++i];
    else if (a === "--config") args.configPath = argv[++i];
    else if (a === "--env") args.envPath = argv[++i];
    else if (a === "--sessions-dir") args.sessionsDir = argv[++i];
    else if (a === "--continue") args.continue = true;
    else if (a === "--resume") args.resume = argv[++i];
    else if (a === "--fork-session") args.forkSession = true;
    else if (a === "--ask-for-approval" || a === "-a") {
      const v = (argv[++i] ?? "").trim().toLowerCase();
      if (v === "untrusted" || v === "on-request" || v === "never") args.askForApproval = v;
      else {
        console.error(color(`Invalid --ask-for-approval value: ${v}`, ansi.red));
        process.exit(2);
      }
    }
    else if (a === "--help" || a === "-h") {
      console.log(`yoof1337 -- terminal coding agent

usage: yoof1337 [options]
  --dir <path>       working directory sandbox (default: cwd)
  --provider <name>  openai | llamacpp (default: from config.json)
  --config <path>    path to config.json
  --env <path>       .env file path (default: ./\.env)
  --sessions-dir <p> session store directory (default: user-local)
  --continue         resume the most recent session
  --resume <id>      resume a specific session
  --fork-session     create a new session from a resumed one
  -a, --ask-for-approval <p>  untrusted | on-request | never (default: on-request)
  --yolo             (deprecated) same as --ask-for-approval never
  --tui              enable Ink TUI (off by default)
  --plain            disable TUI (use basic readline)
  --docker           run run_command inside docker (opt-in isolation)
  --docker-image <i> docker image to use (default: node:22)
  --unsafe-host      (deprecated) same as default host mode

in-session commands: /compact  /state  /help  /exit`);
      process.exit(0);
    }
  }
  return args;
}

import { SessionLogger } from "../sessions/logger.js";
import { getLastSessionId } from "../sessions/store.js";

import { mcpManager } from "../tools/MCPConnectionManager.js";

async function initSessionLogger(
  args: CliArgs, 
  sessionsDir: string, 
  providerName: string, 
  client: ReturnType<typeof createClient>, 
  sandboxRoot: string
): Promise<{ state: AgentState; logger: SessionLogger; instructions: LoadedInstructions | null }> {
  // Initialize MCP servers in the background
  mcpManager.initialize().catch(err => {
    console.error("Failed to initialize MCP servers:", err);
  });
  
  const { taskStore } = await import("../tasks/taskStore.js");
  taskStore.init(sandboxRoot);

  const instructions = await loadWorkspaceInstructions(sandboxRoot);
  let state = createAgentState(buildSystemPrompt(providerName, instructions));
  let baseId = args.resume;
  
  if (args.continue && !baseId) {
    baseId = await getLastSessionId(sessionsDir, sandboxRoot) ?? undefined;
  }

  if (baseId) {
    try {
      const stored = await loadSession(sessionsDir, baseId);
      applyStoredSession(state, stored);
      
      if (args.forkSession) {
        state.sessionId = newSessionId();
        const logger = new SessionLogger(sessionsDir, state.sessionId);
        await logger.logSync({
          type: "meta",
          id: state.sessionId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          provider: providerName,
          model: client.model,
          sandboxRoot,
          title: stored.meta.title + " (forked)",
        });
        
        // rewrite all history into the new log
        for (const msg of state.messages) {
          if (msg.role === "user") await logger.logSync({ type: "user", content: msg.content ?? "", originalTask: state.originalTask ?? undefined });
          else if (msg.role === "assistant") logger.logAsync({ type: "assistant", content: msg.content ?? "", toolCalls: msg.toolCalls });
          else if (msg.role === "tool") logger.logAsync({ type: "tool", toolCallId: msg.toolCallId ?? "", content: msg.content ?? "" });
        }
        logger.logAsync({ type: "progress", world: state.world });
        return { state, logger, instructions };
      } else {
        state.sessionId = stored.meta.id;
        const logger = new SessionLogger(sessionsDir, state.sessionId);
        return { state, logger, instructions };
      }
    } catch (err) {
      console.log(color(`resume failed: ${err instanceof Error ? err.message : String(err)}`, ansi.red));
      // fall through to new session
    }
  }

  // New session
  state.sessionId = newSessionId();
  const logger = new SessionLogger(sessionsDir, state.sessionId);
  await logger.logSync({
    type: "meta",
    id: state.sessionId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    provider: providerName,
    model: client.model,
    sandboxRoot,
    title: "untitled",
  });
  return { state, logger, instructions };
}

async function runPlain(args: CliArgs, sandbox: SandboxContext): Promise<void> {
  const dotenv = loadDotEnv({ envPath: args.envPath });
  const config = loadConfig(args.configPath);
  const providerName = args.provider ?? config.provider;
  const client = createClient(config, args.provider);
  const sessionsDir = path.resolve(args.sessionsDir ?? defaultSessionsDir());
  const { state, logger, instructions } = await initSessionLogger(args, sessionsDir, providerName, client, sandbox.root);

  const persist = async (): Promise<void> => {
    await logger.flush();
  };

  const customToolCount = await loadCustomTools(sandbox.root);

  console.log(`yoof1337 -- model: ${client.model} | sandbox: ${sandbox.root}`);
  if (instructions) console.log(color(`✓ Loaded custom instructions from: ${instructions.filename}`, ansi.green));
  if (dotenv.loaded) console.log(color(`loaded env: ${dotenv.path}`, ansi.dim));
  console.log(color(`session: ${state.sessionId} (${sessionsDir})`, ansi.dim));
  if (args.yolo) console.log(color("! yolo mode: all tool calls auto-approved", ansi.yellow));
  if (client.checkHealth) {
    client.checkHealth().then((h) => {
      if (h.ok) console.log(color(`✓ Endpoint online: ${h.message}`, ansi.green));
      else console.log(color(`⚠️ Endpoint warning: ${h.message}`, ansi.yellow));
    });
  }
  console.log(color("type a task, or /help for commands\n", ansi.dim));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const permissions = {
    yolo: args.yolo,
    approvalPolicy: args.yolo ? "never" : args.askForApproval,
    allowCommandPrefixes: state.world.permissions.allowCommandPrefixes,
    rules: { alwaysAllow: [], alwaysDeny: [], alwaysAsk: [] },
  };
  const stats = {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalLlmCalls: 0,
    totalToolCalls: 0,
    totalGenerationTimeMs: 0,
  };
  let plainStreaming = false;
  const io = {
    print: (t: string) => {
      if (plainStreaming) {
        process.stdout.write("\n");
        plainStreaming = false;
      }
      console.log(t);
    },
    onToken: (token: string) => {
      plainStreaming = true;
      process.stdout.write(token);
    },
    rl,
    format: renderMarkdownToPlain,
    sessionLogger: logger,
    onTurnEnd: (p: any) => {
      if (plainStreaming) {
        process.stdout.write("\n");
        plainStreaming = false;
      }
      if (p) {
        stats.totalPromptTokens += p.promptTokens ?? 0;
        stats.totalCompletionTokens += p.completionTokens ?? 0;
        stats.totalLlmCalls += p.llmCalls ?? 0;
        stats.totalToolCalls += p.toolCalls ?? 0;
        stats.totalGenerationTimeMs += p.elapsedMs ?? 0;
      }
    },
  };

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
    if (line === "/clear" || line === "/cls") {
      console.clear();
      continue;
    }
    if (line === "/reset" || line === "/new") {
      state.messages = [{ role: "system", content: state.systemPrompt }];
      state.world.filesTouched.clear();
      state.world.commandsRun = [];
      state.world.bgCommandsRun = [];
      state.world.memory.decisions = [];
      console.log(color("✓ Session reset. Conversation history and world state cleared.", ansi.green));
      continue;
    }
    if (line === "/health" || line === "/ping") {
      if (client.checkHealth) {
        console.log(color("Pinging model endpoint...", ansi.dim));
        const h = await client.checkHealth();
        if (h.ok) console.log(color(`✓ Endpoint online: ${h.message}`, ansi.green));
        else console.log(color(`⚠️ Endpoint warning: ${h.message}`, ansi.yellow));
      } else {
        console.log(color(`Active model: ${client.model} (no custom health probe)`, ansi.dim));
      }
      continue;
    }
    if (line === "/tasks") {
      const tasks = taskStore.list();
      if (tasks.length === 0) console.log("(no active or queued tasks)");
      else {
        for (const t of tasks) {
          console.log(`[${t.status}] ${t.id} (${t.assignee}) — ${t.prompt.slice(0, 80)}`);
        }
      }
      continue;
    }
    if (line === "/tools" || line.startsWith("/tools ")) {
      const parts = line.split(/\s+/);
      const sub = parts[1]?.toLowerCase();
      const target = parts[2]?.toLowerCase();

      if (sub === "reset") {
        resetToolsToCore();
        console.log(color("✓ Tools reset to default lean core set.", ansi.green));
      } else if (sub === "activate" && target) {
        const req = registry.get("request_tools");
        if (req) {
          const res = await req.execute({ category: target, action: "activate" }, sandbox);
          console.log(color(res, ansi.green));
        }
      } else if (sub === "deactivate" && target) {
        const req = registry.get("request_tools");
        if (req) {
          const res = await req.execute({ category: target, action: "deactivate" }, sandbox);
          console.log(color(res, ansi.yellow));
        }
      } else {
        const categories = registry.getAvailableCategories();
        for (const cat of categories) {
          const statusBadge = cat.active ? color("[active]", ansi.green) : color("[inactive]", ansi.dim);
          console.log(`${color(cat.category, ansi.bold)} ${statusBadge}: ${cat.tools.join(", ")}`);
        }
        console.log(color("Usage: /tools | /tools reset | /tools activate <cat> | /tools deactivate <cat>", ansi.dim));
      }
      continue;
    }
    if (line === "/tree") {
      const treeOut = await treeDirectory({ maxDepth: 3 }, sandbox);
      console.log(treeOut);
      continue;
    }
    if (line === "/prompt" || line.startsWith("/prompt ")) {
      const parts = line.split(/\s+/);
      const sub = parts[1]?.toLowerCase();
      if (sub === "reload") {
        const fresh = await loadWorkspaceInstructions(sandbox.root);
        state.systemPrompt = buildSystemPrompt(providerName, fresh);
        if (state.messages.length > 0 && state.messages[0].role === "system") {
          state.messages[0].content = state.systemPrompt;
        }
        if (fresh) {
          console.log(color(`✓ Reloaded custom instructions from: ${fresh.filename}`, ansi.green));
        } else {
          console.log(color("No custom instruction files found in workspace root.", ansi.yellow));
        }
      } else {
        console.log(color("\n--- Active System Prompt ---", ansi.bold));
        console.log(state.systemPrompt);
        console.log(color("\nTip: Place an AGENTS.md, CLAUDE.md, or .yoof1337/system_prompt.md in your project root.", ansi.dim));
        console.log(color("Use '/prompt reload' to refresh instructions after editing.", ansi.dim));
      }
      continue;
    }
    if (line === "/permission" || line.startsWith("/permission ") || line === "/permissions" || line.startsWith("/permissions ")) {
      const parts = line.split(/\s+/);
      const mode = parts[1]?.toLowerCase();

      if (mode === "auto" || mode === "yolo" || mode === "never") {
        permissions.yolo = true;
        permissions.approvalPolicy = "never";
        console.log(color("✓ Permission mode set to AUTO (all mutations auto-approved)", ansi.green));
      } else if (mode === "strict" || mode === "prompt" || mode === "untrusted") {
        permissions.yolo = false;
        permissions.approvalPolicy = "untrusted";
        console.log(color("✓ Permission mode set to STRICT (confirmation required for all mutations)", ansi.yellow));
      } else if (mode === "reset") {
        if (permissions.rules) permissions.rules.alwaysAllow = [];
        console.log(color("✓ Session auto-allowed rules cleared.", ansi.green));
      } else {
        const isAuto = permissions.yolo || permissions.approvalPolicy === "never";
        console.log(color("\n🛡️ Permission Configuration", ansi.bold));
        console.log(`  • Active Mode:     ${isAuto ? color("AUTO (yolo)", ansi.green) : color("STRICT (ask confirmation)", ansi.yellow)}`);
        console.log(`  • Approval Policy: ${permissions.approvalPolicy}`);
        if (permissions.rules && permissions.rules.alwaysAllow.length > 0) {
          console.log(`  • Session Allowed: ${permissions.rules.alwaysAllow.join(", ")}`);
        }
        console.log(color("\nUsage: /permission strict | /permission auto | /permission reset\n", ansi.dim));
      }
      continue;
    }
    if (line === "/stats") {
      const elapsedSec = Math.max(0.1, stats.totalGenerationTimeMs / 1000);
      const speed = (stats.totalCompletionTokens / elapsedSec).toFixed(1);
      const totalTokens = stats.totalPromptTokens + stats.totalCompletionTokens;
      const isLocal = providerName === "llamacpp" || client.baseUrl?.includes("localhost") || client.baseUrl?.includes("127.0.0.1");
      const estCost = isLocal ? "$0.00 (local GPU)" : `$${((stats.totalPromptTokens * 0.0015 + stats.totalCompletionTokens * 0.002) / 1000).toFixed(4)}`;

      console.log(color("\n📊 Session Performance & Token Analytics", ansi.bold));
      console.log(`  • Generation Speed:    ${color(`${speed} tok/s`, ansi.green)}`);
      console.log(`  • Total Generated:     ${stats.totalCompletionTokens.toLocaleString()} tokens`);
      console.log(`  • Total Prompt Tokens: ${stats.totalPromptTokens.toLocaleString()} tokens`);
      console.log(`  • Total Combined:      ${totalTokens.toLocaleString()} tokens`);
      console.log(`  • LLM Round-Trips:     ${stats.totalLlmCalls}`);
      console.log(`  • Tool Invocations:    ${stats.totalToolCalls}`);
      console.log(`  • Context Window:      ${client.contextWindow.toLocaleString()} tokens`);
      console.log(`  • Estimated Cost:      ${color(estCost, ansi.yellow)}\n`);
      continue;
    }
    if (line === "/model") {
      console.log(`Active Provider: ${providerName} | Model: ${client.model} | Context: ${client.contextWindow} tokens`);
      console.log(`Available in config: ${Object.keys(config.providers).join(", ")}`);
      continue;
    }
    if (line === "/help") {
      console.log(
        `${color("/clear", ansi.cyan)}    clear the console log\n${color("/reset", ansi.cyan)}    start a fresh conversation\n${color("/compact", ansi.cyan)}  summarize and shrink the conversation history\n${color("/state", ansi.cyan)}    show tracked world state and token estimate\n${color("/health", ansi.cyan)}   ping model endpoint health\n${color("/stats", ansi.cyan)}    view token speed and session stats\n${color("/tasks", ansi.cyan)}    list background sub-agents and tasks\n${color("/tools", ansi.cyan)}    list all registered tools\n${color("/tree", ansi.cyan)}     print visual directory tree\n${color("/prompt", ansi.cyan)}   view or reload custom instructions (AGENTS.md)\n${color("/model", ansi.cyan)}    show active model and available providers\n${color("/sessions", ansi.cyan)} list saved sessions\n${color("/resume <id>", ansi.cyan)} resume a saved session\n${color("/save", ansi.cyan)}     save current session snapshot\n${color("/undo", ansi.cyan)}     rollback to last git checkpoint\n${color("/redo", ansi.cyan)}     step forward one git checkpoint\n${color("/status", ansi.cyan)}   git status\n${color("/diff", ansi.cyan)}     git diff\n${color("/gh auth", ansi.cyan)}  show gh auth status\n${color("/pr view <id>", ansi.cyan)} view PR\n${color("/pr diff <id>", ansi.cyan)} diff PR\n${color("/pr create <title>", ansi.cyan)} create PR\n${color("/pr comment <id>", ansi.cyan)} comment PR\n${color("/exit", ansi.cyan)}     quit`
      );
      continue;
    }
    if (line === "/status") {
      await cmdStatus();
      continue;
    }
    if (line === "/undo") {
      try {
        await execa("git", ["reset", "--hard", "HEAD"], { cwd: sandbox.root, windowsHide: true });
        await execa("git", ["clean", "-fd"], { cwd: sandbox.root, windowsHide: true });
        console.log(color("Undo complete. Git state reverted.", ansi.green));
      } catch (err) {
        console.log(color(`undo failed: ${err instanceof Error ? err.message : String(err)}`, ansi.red));
      }
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
      const sessions = await listSessions(sessionsDir, sandbox.root);
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

    const tagged = await expandFileTags(line, sandbox);
    if (tagged.attachedFiles.length > 0) {
      console.log(color(`📎 Attached file context: ${tagged.attachedFiles.join(", ")}`, ansi.cyan));
    }
    await runTurn(state, tagged.expandedText, client, config, sandbox, permissions, io);
    try {
      await logger.flush();
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
  const sessionsDir = path.resolve(args.sessionsDir ?? defaultSessionsDir());
  const { state, logger, instructions } = await initSessionLogger(args, sessionsDir, providerName, client, sandbox.root);

  const app: {
    start: () => void;
    stop: () => void;
    println: (t: string) => void;
    clear?: () => void;
    setStatus?: (t: string) => void;
    setStatusline?: (t: string) => void;
    setTools?: (lines: string[]) => void;
    setBusy?: (busy: null | { activity: string; startedAt: number; detail?: string }) => void;
    setLastFoldedOutput?: (output: string | null) => void;
    readLine: (promptLabel?: string) => Promise<string | null>;
    createQuestioner: () => any;
    onSigInt?: (handler: () => void) => void;
    streamChunk?: (chunk: string) => void;
    endStream?: () => void;
    setPermissionMode?: (mode: "strict" | "auto") => void;
  } = createInkUi({
    title: "yoof1337",
    subtitle: `🧠 model: ${client.model}  📁 sandbox: ${sandbox.root}`,
    sandboxRoot: sandbox.root,
  }) as any;
  app.setPermissionMode?.(args.yolo ? "auto" : "strict");
  await loadCustomTools(sandbox.root);
  app.start();
  if (instructions) {
    app.println(color(`✓ Loaded custom instructions from: ${instructions.filename}`, ansi.green));
  }
  if (client.checkHealth) {
    client.checkHealth().then((h) => {
      if (h.ok) app.println(color(`✓ Endpoint online: ${h.message}`, ansi.green));
      else app.println(color(`⚠️ Endpoint warning: ${h.message}`, ansi.yellow));
    });
  }
  const questioner = app.createQuestioner();
  const permissions = {
    yolo: args.yolo,
    approvalPolicy: args.yolo ? "never" : args.askForApproval,
    allowCommandPrefixes: state.world.permissions.allowCommandPrefixes,
    rules: { alwaysAllow: [], alwaysDeny: [], alwaysAsk: [] },
  };
  const tuiStats = {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalLlmCalls: 0,
    totalToolCalls: 0,
    totalGenerationTimeMs: 0,
  };
  let turnStartedAt = Date.now();
  let lastContextTokens = 0;
  const io = {
    print: (t: string) => app.println(t),
    onToken: (token: string) => {
      if (app.streamChunk) app.streamChunk(token);
    },
    rl: questioner,
    format: renderMarkdownToPlain,
    formatToolResult: (_name: string, result: string) => result,
    sessionLogger: logger,
    onTurnStart: () => {
      turnStartedAt = Date.now();
    },
    onLlmStart: (activity: string) => {
      app.setBusy?.({ activity, startedAt: Date.now() });
    },
    onProgress: (activity: string, p: TurnProgress) => {
      app.setBusy?.({ activity, startedAt: turnStartedAt, detail: progressDetail(p) });
    },
    onTurnEnd: (p: TurnProgress) => {
      app.setBusy?.(null);
      app.println(color(`✻ ${turnSummary(p)}`, ansi.dim));
    },
    onToolStart: (name: string) => {
      app.setBusy?.({ activity: name, startedAt: turnStartedAt });
      toolPanel.push(`> ${name}`);
      app.setTools?.(toolPanel);
    },
    onToolEnd: (name: string, result: string, approved: boolean, durationMs?: number) => {
      const timeStr = durationMs ? `took ${(durationMs / 1000).toFixed(1)}s` : "";
      const head = approved ? `✓ ${name}` : `✗ ${name}`;
      const firstLine = String(result ?? "").split(/\r?\n/, 1)[0] ?? "";
      toolPanel.push(`${head}: ${firstLine.slice(0, 60)} ${timeStr}`);
      app.setTools?.(toolPanel);

      // Inline feedback & human-readable errors with hints
      const outText = String(result ?? "");
      let hint = hintForToolResult(name, outText) || "";
      if (hint) {
        hint = `\n${color(hint, ansi.yellow)}`;
      }

      const formattedResult = io.formatToolResult(name, outText);
      const outputLines = formattedResult.split("\n");
      let foldedResult = formattedResult;
      if (outputLines.length > 20) {
        foldedResult = outputLines.slice(0, 20).join("\n") + color(`\n... [${outputLines.length - 20} lines folded] (Press Ctrl+O to expand)`, ansi.dim);
        app.setLastFoldedOutput?.(formattedResult);
      } else {
        app.setLastFoldedOutput?.(null);
      }

      app.println(`${color(head, approved ? ansi.green : ansi.red)} ${color(timeStr, ansi.dim)}\n${foldedResult}${hint}`);
    },
  };

  app.println(color("/help for commands • /exit to quit", ansi.dim));
  if (dotenv.loaded) app.println(color(`loaded env: ${dotenv.path}`, ansi.dim));
  app.println(color(`session: ${state.sessionId} (${sessionsDir})`, ansi.dim));
  if (args.yolo) app.println(color("! yolo mode: all tool calls auto-approved", ansi.yellow));

  const toolPanel: string[] = [];

  async function refreshStatusline(): Promise<void> {
    const git = await getGitStatusLine(sandbox.root);
    const cwdStr = sandbox.root.split(path.sep).pop() || sandbox.root;
    const exec = sandbox.execMode === "docker" ? "docker" : "host";
    const approval = args.yolo ? "yolo" : "prompt";

    // Prefer the server's real prompt-token count from the last LLM call (true
    // context fill); fall back to the char/4 heuristic before any call reports usage.
    const ctxWindow = client.contextWindow;
    let tokStr: string;
    if (lastContextTokens > 0) {
      const pct = ctxWindow > 0 ? Math.round((lastContextTokens / ctxWindow) * 100) : 0;
      tokStr = `🪙 tok:${formatTokens(lastContextTokens)}/${formatTokens(ctxWindow)} (${pct}%)`;
    } else {
      tokStr = `🪙 tok:~${formatTokens(estimateTokens(state.messages))}`;
    }

    const parts = [
      `💻 ${cwdStr}`,
      `⚡ exec:${exec}`,
      `✅ apprv:${approval}`,
      tokStr,
    ];
    if (git) {
      parts.push(`🌿 git:${git}`);
    }
    app.setStatusline?.(parts.join("  "));
  }
  await refreshStatusline();

  const persist = async (): Promise<void> => {
    await logger.flush();
  };

  const printResumedMessages = (state: ReturnType<typeof createAgentState>) => {
    for (const msg of state.messages) {
      if (msg.role === "user" && msg.content) {
        app.println(`\n${color("you>", ansi.blue)} ${msg.content}`);
      } else if (msg.role === "assistant") {
        if (msg.content) {
          app.println(`\n${renderMarkdownToPlain(msg.content)}`);
        }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const call of msg.toolCalls) {
            app.println(`${color("✓ " + call.name, ansi.green)} ${color("(resumed)", ansi.dim)}`);
          }
        }
      }
    }
  };

  const allSessions = await listSessions(sessionsDir, sandbox.root);
  // Exclude the session we just created so we don't ask to resume ourselves
  const previousSessions = allSessions.filter((s) => s.id !== state.sessionId);
  if (previousSessions.length > 0) {
    const latest = previousSessions[0];
    const resumeAns = await app.readLine(`Resume last session (${latest.title})? [Y/n]> `);
    if (resumeAns !== null && resumeAns.trim().toLowerCase() !== "n") {
      try {
        const stored = await loadSession(sessionsDir, latest.id);
        applyStoredSession(state, stored);
        state.sessionId = stored.meta.id;
        printResumedMessages(state);
        app.println(color(`resumed session ${stored.meta.id}`, ansi.green));
      } catch (err) {
        app.println(color(`resume failed: ${err instanceof Error ? err.message : String(err)}`, ansi.red));
      }
    }
  }

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

      app.println(`${color("you>", ansi.gray)} ${line}`);

      if (line === "/exit" || line === "/quit") break;
      if (line === "/clear" || line === "/cls") {
        app.clear?.();
        continue;
      }
      if (line === "/reset" || line === "/new") {
        state.messages = [{ role: "system", content: state.systemPrompt }];
        state.world.filesTouched.clear();
        state.world.commandsRun = [];
        state.world.bgCommandsRun = [];
        state.world.memory.decisions = [];
        app.println(color("✓ Session reset. Conversation history and world state cleared.", ansi.green));
        continue;
      }
      if (line === "/health" || line === "/ping") {
        if (client.checkHealth) {
          app.println(color("Pinging model endpoint...", ansi.dim));
          const h = await client.checkHealth();
          if (h.ok) app.println(color(`✓ Endpoint online: ${h.message}`, ansi.green));
          else app.println(color(`⚠️ Endpoint warning: ${h.message}`, ansi.yellow));
        } else {
          app.println(color(`Active model: ${client.model} (no custom health probe)`, ansi.dim));
        }
        continue;
      }
      if (line === "/tasks") {
        const tasks = taskStore.list();
        if (tasks.length === 0) app.println("(no active or queued tasks)");
        else {
          for (const t of tasks) {
            app.println(`[${t.status}] ${t.id} (${t.assignee}) — ${t.prompt.slice(0, 80)}`);
          }
        }
        continue;
      }
      if (line === "/tools" || line.startsWith("/tools ")) {
        const parts = line.split(/\s+/);
        const sub = parts[1]?.toLowerCase();
        const target = parts[2]?.toLowerCase();

        if (sub === "reset") {
          resetToolsToCore();
          app.println(color("✓ Tools reset to default lean core set.", ansi.green));
        } else if (sub === "activate" && target) {
          const req = registry.get("request_tools");
          if (req) {
            const res = await req.execute({ category: target, action: "activate" }, sandbox);
            app.println(color(res, ansi.green));
          }
        } else if (sub === "deactivate" && target) {
          const req = registry.get("request_tools");
          if (req) {
            const res = await req.execute({ category: target, action: "deactivate" }, sandbox);
            app.println(color(res, ansi.yellow));
          }
        } else {
          const categories = registry.getAvailableCategories();
          for (const cat of categories) {
            const statusBadge = cat.active ? color("[active]", ansi.green) : color("[inactive]", ansi.dim);
            app.println(`${color(cat.category, ansi.bold)} ${statusBadge}: ${cat.tools.join(", ")}`);
          }
          app.println(color("Usage: /tools | /tools reset | /tools activate <cat> | /tools deactivate <cat>", ansi.dim));
        }
        continue;
      }
      if (line === "/tree") {
        const treeOut = await treeDirectory({ maxDepth: 3 }, sandbox);
        app.println(treeOut);
        continue;
      }
      if (line === "/prompt" || line.startsWith("/prompt ")) {
        const parts = line.split(/\s+/);
        const sub = parts[1]?.toLowerCase();
        if (sub === "reload") {
          const fresh = await loadWorkspaceInstructions(sandbox.root);
          state.systemPrompt = buildSystemPrompt(providerName, fresh);
          if (state.messages.length > 0 && state.messages[0].role === "system") {
            state.messages[0].content = state.systemPrompt;
          }
          if (fresh) {
            app.println(color(`✓ Reloaded custom instructions from: ${fresh.filename}`, ansi.green));
          } else {
            app.println(color("No custom instruction files found in workspace root.", ansi.yellow));
          }
        } else {
          app.println(color("--- Active System Prompt ---", ansi.bold));
          app.println(state.systemPrompt);
          app.println(color("Tip: Place an AGENTS.md, CLAUDE.md, or .yoof1337/system_prompt.md in your project root.", ansi.dim));
          app.println(color("Use '/prompt reload' to refresh instructions after editing.", ansi.dim));
        }
        continue;
      }
      if (line === "/permission" || line.startsWith("/permission ") || line === "/permissions" || line.startsWith("/permissions ")) {
        const parts = line.split(/\s+/);
        const mode = parts[1]?.toLowerCase();

        if (mode === "auto" || mode === "yolo" || mode === "never") {
          permissions.yolo = true;
          permissions.approvalPolicy = "never";
          app.setPermissionMode?.("auto");
          app.println(color("✓ Permission mode set to AUTO (all mutations auto-approved)", ansi.green));
        } else if (mode === "strict" || mode === "prompt" || mode === "untrusted") {
          permissions.yolo = false;
          permissions.approvalPolicy = "untrusted";
          app.setPermissionMode?.("strict");
          app.println(color("✓ Permission mode set to STRICT (confirmation required for all mutations)", ansi.yellow));
        } else if (mode === "reset") {
          if (permissions.rules) permissions.rules.alwaysAllow = [];
          app.println(color("✓ Session auto-allowed rules cleared.", ansi.green));
        } else {
          const isAuto = permissions.yolo || permissions.approvalPolicy === "never";
          app.println(color("🛡️ Permission Configuration", ansi.bold));
          app.println(`  • Active Mode:     ${isAuto ? color("AUTO (yolo)", ansi.green) : color("STRICT (ask confirmation)", ansi.yellow)}`);
          app.println(`  • Approval Policy: ${permissions.approvalPolicy}`);
          if (permissions.rules && permissions.rules.alwaysAllow.length > 0) {
            app.println(`  • Session Allowed: ${permissions.rules.alwaysAllow.join(", ")}`);
          }
          app.println(color("Usage: /permission strict | /permission auto | /permission reset", ansi.dim));
        }
        continue;
      }
      if (line === "/stats") {
        const elapsedSec = Math.max(0.1, tuiStats.totalGenerationTimeMs / 1000);
        const speed = (tuiStats.totalCompletionTokens / elapsedSec).toFixed(1);
        const totalTokens = tuiStats.totalPromptTokens + tuiStats.totalCompletionTokens;
        const isLocal = providerName === "llamacpp" || client.baseUrl?.includes("localhost") || client.baseUrl?.includes("127.0.0.1");
        const estCost = isLocal ? "$0.00 (local GPU)" : `$${((tuiStats.totalPromptTokens * 0.0015 + tuiStats.totalCompletionTokens * 0.002) / 1000).toFixed(4)}`;

        app.println(color("📊 Session Performance & Token Analytics", ansi.bold));
        app.println(`  • Generation Speed:    ${color(`${speed} tok/s`, ansi.green)}`);
        app.println(`  • Total Generated:     ${tuiStats.totalCompletionTokens.toLocaleString()} tokens`);
        app.println(`  • Total Prompt Tokens: ${tuiStats.totalPromptTokens.toLocaleString()} tokens`);
        app.println(`  • Total Combined:      ${totalTokens.toLocaleString()} tokens`);
        app.println(`  • LLM Round-Trips:     ${tuiStats.totalLlmCalls}`);
        app.println(`  • Tool Invocations:    ${tuiStats.totalToolCalls}`);
        app.println(`  • Context Window:      ${client.contextWindow.toLocaleString()} tokens`);
        app.println(`  • Estimated Cost:      ${color(estCost, ansi.yellow)}`);
        continue;
      }
      if (line === "/model") {
        app.println(`Active Provider: ${providerName} | Model: ${client.model} | Context: ${client.contextWindow} tokens`);
        app.println(`Available in config: ${Object.keys(config.providers).join(", ")}`);
        continue;
      }
      if (line === "/help") {
        app.println(`${color("/clear", ansi.cyan)}    clear the transcript log`);
        app.println(`${color("/reset", ansi.cyan)}    start a fresh conversation session`);
        app.println(`${color("/compact", ansi.cyan)}  summarize and shrink the conversation history`);
        app.println(`${color("/state", ansi.cyan)}    show tracked world state and token estimate`);
        app.println(`${color("/health", ansi.cyan)}   ping model endpoint health`);
        app.println(`${color("/stats", ansi.cyan)}    view token speed and session stats`);
        app.println(`${color("/tasks", ansi.cyan)}    list background sub-agents and tasks`);
        app.println(`${color("/tools", ansi.cyan)}    list all registered tools`);
        app.println(`${color("/tree", ansi.cyan)}     print visual directory tree`);
        app.println(`${color("/prompt", ansi.cyan)}   view or reload custom instructions (AGENTS.md)`);
        app.println(`${color("/model", ansi.cyan)}    show active model and available providers`);
        app.println(`${color("/sessions", ansi.cyan)} list saved sessions`);
        app.println(`${color("/resume <id>", ansi.cyan)} resume a saved session`);
        app.println(`${color("/save", ansi.cyan)}     save current session snapshot`);
        app.println(`${color("/undo", ansi.cyan)}     step back one checkpoint`);
        app.println(`${color("/redo", ansi.cyan)}     step forward one checkpoint`);
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
      if (line === "/undo") {
        app.println(color("rolling back changes...", ansi.yellow));
        try {
          await execa("git", ["reset", "--hard", "HEAD~1"], { cwd: sandbox.root, windowsHide: true });
          await execa("git", ["clean", "-fd"], { cwd: sandbox.root, windowsHide: true });
          app.println(color("Undo complete. Stepped back one checkpoint.", ansi.green));
        } catch (err) {
          app.println(color(`undo failed: ${err instanceof Error ? err.message : String(err)}`, ansi.red));
        }
        continue;
      }
      if (line === "/redo") {
        app.println(color("stepping forward...", ansi.yellow));
        try {
          await execa("git", ["reset", "--hard", "HEAD@{1}"], { cwd: sandbox.root, windowsHide: true });
          await execa("git", ["clean", "-fd"], { cwd: sandbox.root, windowsHide: true });
          app.println(color("Redo complete. Stepped forward one checkpoint.", ansi.green));
        } catch (err) {
          app.println(color(`redo failed: ${err instanceof Error ? err.message : String(err)}`, ansi.red));
        }
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
        const list = await listSessions(sessionsDir, sandbox.root);
        if (list.length === 0) app.println("(no saved sessions)");
        else {
          for (const s of list) {
            app.println(`${color(s.id, ansi.cyan)} ${color(s.title, ansi.bold)} ${color(`(${s.model})`, ansi.dim)}`);
          }
        }
        continue;
      }
      if (line.startsWith("/resume ")) {
        app.println(color("Please restart yoof1337 and pass the --resume <id> flag.", ansi.yellow));
        continue;
      }
      if (line === "/save") {
        app.println(color("session is automatically saved continuously to " + logger.filepath, ansi.green));
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

      let abortController: AbortController | null = null;
      let turnRunning = false;

      app.onSigInt?.(() => {
        if (turnRunning && abortController) {
          app.println(color("Canceling operation...", ansi.yellow));
          abortController.abort();
        } else {
          app.stop();
          process.exit(0);
        }
      });

      app.setStatus?.(color("working...", ansi.dim));
      abortController = new AbortController();
      turnRunning = true;
      const turnIo = { ...io, abortSignal: abortController.signal };
      const tagged = await expandFileTags(line, sandbox);
      if (tagged.attachedFiles.length > 0) {
        app.println(color(`📎 Attached file context: ${tagged.attachedFiles.join(", ")}`, ansi.cyan));
      }
      await runTurn(state, tagged.expandedText, client, config, sandbox, permissions, turnIo);
      turnRunning = false;
      abortController = null;
      app.onSigInt?.(() => { app.stop(); process.exit(0); }); // reset to exit

      app.setStatus?.(color("done (enter next task)", ansi.dim));
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
    return `${branch.stdout.trim()}${dirty ? "*" : ""}`;
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

  const { initCoordinator } = await import("../tasks/coordinator.js");
  initCoordinator(sandbox);

  // Default to plain mode unless the user explicitly opts into the TUI.
  const canTui = process.stdout.isTTY && process.stdin.isTTY;
  const wantTui = !args.plain && args.tui && canTui;
  if (wantTui) return runTui(args, sandbox);
  return runPlain(args, sandbox);
}

main().catch((err) => {
  console.error(color(err instanceof Error ? err.message : String(err), ansi.red));
  process.exit(1);
});
