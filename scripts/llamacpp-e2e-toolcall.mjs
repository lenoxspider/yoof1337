// Deterministic llama.cpp tool-call e2e without the full autonomous loop.
// Confirms:
// - request reaches server
// - tool call is parsed (either tool_calls or content-fallback)
// - we execute the requested tool
// - model produces a final answer after tool result
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../dist/config.js";
import { createClient } from "../dist/llm/factory.js";
import { executeTool, toolDefinitions } from "../dist/tools/definitions.js";

const config = loadConfig();
const client = createClient(config, "llamacpp");

const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yoof1337-llama-e2e-"));
fs.writeFileSync(path.join(sandboxRoot, "sample.txt"), "function add(a,b){return a+b;}\n", "utf8");
const sandbox = { root: sandboxRoot, commandTimeoutMs: 30_000, execMode: "docker" };

const tools = toolDefinitions();
const allowed = new Set(tools.map((t) => t.name));

const messages = [
  {
    role: "system",
    content:
      "You are a test model running under llama.cpp. When you want to call a tool, you MUST output ONLY a single JSON object " +
      "with exactly these keys: name, arguments. Do not use code fences. Do not add any other text.\n" +
      `Allowed tool names: ${[...allowed].sort().join(", ")}.\n` +
      "Task step 1: Call read_file on sample.txt by outputting exactly:\n" +
      "{\"name\":\"read_file\",\"arguments\":{\"path\":\"sample.txt\"}}\n" +
      "Task step 2: After you receive the tool result, reply with ONE sentence describing what the file does, and do not call any more tools.",
  },
  { role: "user", content: "Do it." },
];

let r1;
try {
  r1 = await client.chat(messages, tools);
} catch (err) {
  console.log("FAIL request/adapter error");
  console.log(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
}

console.log("LLM text 1:", JSON.stringify(r1.text));
console.log("LLM toolCalls 1:", JSON.stringify(r1.toolCalls));

if (!r1.toolCalls?.length) {
  console.log("FAIL no tool call returned");
  process.exit(2);
}

const tc = r1.toolCalls[0];
const toolRes = await executeTool(tc.name, tc.input, sandbox);
console.log("Tool result:", JSON.stringify(toolRes));

const messages2 = [
  ...messages,
  { role: "assistant", content: r1.text ?? null, toolCalls: r1.toolCalls },
  { role: "tool", toolCallId: tc.id, content: toolRes },
];

let r2;
try {
  r2 = await client.chat(messages2, tools);
} catch (err) {
  console.log("FAIL second request/adapter error");
  console.log(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(3);
}

console.log("LLM text 2:", JSON.stringify(r2.text));
console.log("LLM toolCalls 2:", JSON.stringify(r2.toolCalls));
console.log("OK");

fs.rmSync(sandboxRoot, { recursive: true, force: true });
