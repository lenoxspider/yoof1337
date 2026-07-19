import { createAgentState } from "../loop/state.js";
import { runTurn } from "../loop/agentLoop.js";
import { loadConfig } from "../config.js";
import { createClient } from "../llm/factory.js";
import type { LoopIO } from "../loop/agentLoop.js";

// The worker process is forked with the necessary env vars
const taskId = process.env.YOOF_TASK_ID;
const prompt = process.env.YOOF_TASK_PROMPT;
const provider = process.env.YOOF_PROVIDER;
const sandboxRoot = process.env.YOOF_SANDBOX_ROOT;
const systemPrompt = process.env.YOOF_SYSTEM_PROMPT;
const maxIterations = parseInt(process.env.YOOF_MAX_ITERATIONS || "50", 10);

if (!taskId || !prompt || !sandboxRoot) {
  process.exit(1);
}

const config = loadConfig();
const finalProvider = provider || config.provider;

const io: LoopIO = {
  print: (text: string) => {
    process.send?.({ type: "log", taskId, msg: text + "\n" });
  },
  abortSignal: new AbortController().signal,
};

async function main() {
  process.send?.({ type: "status", taskId, status: "running" });

  try {
    const client = createClient(config, finalProvider);
    const state = createAgentState(systemPrompt!);
    
    const permissions = { yolo: true, allowCommandPrefixes: [] as string[] };
    const ctx = { root: sandboxRoot!, commandTimeoutMs: config.commandTimeoutMs };

    await runTurn(state, prompt!, client, config, ctx, permissions, io);

    const finalMsg = [...state.messages].reverse().find(m => m.role === "assistant" && m.content);
    const result = finalMsg?.content ?? "(no output)";

    process.send?.({ type: "completed", taskId, result: typeof result === "string" ? result : "(no output)" });
  } catch (err: any) {
    process.send?.({ type: "failed", taskId, error: err.message });
  }
}

main().catch(err => {
  process.send?.({ type: "failed", taskId, error: String(err) });
});
