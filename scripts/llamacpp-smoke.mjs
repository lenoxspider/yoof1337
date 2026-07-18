// llama.cpp e2e smoke test: expects an OpenAI-compatible server already running.
// Validates:
// 1) basic chat completion
// 2) tool calling round-trip: model requests read_file, tool result fed back, model continues
//
// Usage:
//   npm.cmd run build
//   node scripts/llamacpp-smoke.mjs
//
// Configure server/model in config.json providers.llamacpp (baseUrl/model).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../dist/config.js";
import { createClient } from "../dist/llm/factory.js";
import { toolDefinitions, executeTool } from "../dist/tools/definitions.js";
import { createAgentState } from "../dist/loop/state.js";
import { runTurn } from "../dist/loop/agentLoop.js";

const config = loadConfig();
const client = createClient(config, "llamacpp");

const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yoof1337-llamacpp-smoke-"));
fs.writeFileSync(path.join(sandboxRoot, "hello.txt"), "hello from llamacpp\n", "utf8");

const results = [];
let failures = 0;
function check(name, ok, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failures++;
}

async function basicChat() {
  const resp = await client.chat(
    [
      { role: "system", content: "You are a test assistant. Reply with exactly: OK" },
      { role: "user", content: "Say OK" },
    ],
    []
  );
  check("basic chat completion", resp.toolCalls.length === 0 && (resp.text ?? "").trim() === "OK", resp.text ?? "");
}

async function toolRoundTrip() {
  const state = createAgentState(
    "You are a test assistant. You MUST call the tool read_file with {\"path\":\"hello.txt\"} before answering. " +
      "After you receive the tool result, reply with exactly the file contents, nothing else."
  );
  const printed = [];
  await runTurn(
    state,
    "Read hello.txt using the tool, then return its exact contents.",
    client,
    config,
    { root: sandboxRoot, commandTimeoutMs: 30_000, execMode: "docker" },
    { yolo: true },
    { print: (t) => printed.push(t) }
  );

  const usedTool = state.messages.some((m) => m.role === "assistant" && m.toolCalls?.some((t) => t.name === "read_file"));
  check("tool calling requested by model", usedTool);
  const final = printed[printed.length - 1] ?? "";
  check("tool round-trip final answer", final.trim() === "hello from llamacpp", final);
}

// Sanity: ensure the server returns tool_calls in the shape our adapter parses.
async function directToolCallProbe() {
  const resp = await client.chat(
    [
      {
        role: "system",
        content:
          "You MUST call read_file with {\"path\":\"hello.txt\"}. Do not answer normally. Only request the tool.",
      },
      { role: "user", content: "Call the tool now." },
    ],
    toolDefinitions()
  );
  check("direct tool_calls present", resp.toolCalls.length > 0, JSON.stringify(resp.toolCalls[0] ?? {}).slice(0, 200));
  if (resp.toolCalls.length > 0) {
    const call = resp.toolCalls[0];
    const result = await executeTool(call.name, call.input, { root: sandboxRoot, commandTimeoutMs: 30_000, execMode: "docker" });
    check("tool execution succeeded", /hello from llamacpp/i.test(result), result.slice(0, 200));
  }
}

try {
  await basicChat();
  await directToolCallProbe();
  await toolRoundTrip();
} catch (err) {
  check("unexpected error", false, err instanceof Error ? err.message : String(err));
}

fs.rmSync(sandboxRoot, { recursive: true, force: true });
console.log(results.join("\n"));
console.log(failures === 0 ? "\nLLAMACPP SMOKE OK" : `\nLLAMACPP SMOKE FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);

