// Offline smoke test: drives the compiled agent loop with a scripted fake LLM
// client — no API key or network needed. Verifies a full tool-call cycle:
// write_file -> read_file -> search_code -> run_command -> denylist block -> final text.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runTurn } from "../dist/loop/agentLoop.js";
import { createAgentState } from "../dist/loop/state.js";
import { loadConfig } from "../dist/config.js";
import { resolveInSandbox } from "../dist/tools/sandbox.js";
import { executeTool } from "../dist/tools/definitions.js";

const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yoof1337-smoke-"));
const config = loadConfig();
const results = [];
let failures = 0;

function check(name, ok, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// Scripted responses: each entry is what the fake LLM "decides" on that iteration.
const script = [
  { toolCalls: [{ id: "c1", name: "write_file", input: { path: "hello.txt", content: "hello from yoof1337\n" } }], text: null },
  { toolCalls: [{ id: "c2", name: "read_file", input: { path: "hello.txt" } }], text: null },
  { toolCalls: [{ id: "c3", name: "search_code", input: { query: "yoof1337" } }], text: null },
  { toolCalls: [{ id: "c4", name: "run_command", input: { command: "node -e \"console.log('cmd-ok')\"" } }], text: null },
  { toolCalls: [{ id: "c5", name: "run_command", input: { command: "rm -rf /" } }], text: null },
  { toolCalls: [{ id: "c6", name: "read_file", input: { path: "../outside.txt" } }], text: null },
  { toolCalls: [], text: "All checks done." },
];

const fakeClient = {
  model: "fake-model",
  contextWindow: 1_000_000, // high so compaction never triggers here
  step: 0,
  chat(messages) {
    const response = script[this.step];
    if (!response) throw new Error("fake client ran out of scripted responses");
    // Inspect the tool result the loop fed back for the previous call.
    const last = messages[messages.length - 1];
    if (this.step > 0 && last.role === "tool") {
      const prev = script[this.step - 1].toolCalls[0];
      switch (prev.id) {
        case "c1": check("write_file result", /Created hello\.txt/.test(last.content), last.content); break;
        case "c2": check("read_file returns content", last.content.includes("hello from yoof1337"), last.content); break;
        case "c3": check("search_code finds match", /hello\.txt:1:/.test(last.content), last.content); break;
        case "c4": check("run_command captures stdout+exit", /exit code: 0/.test(last.content) && /cmd-ok/.test(last.content)); break;
        case "c5": check("denylist blocks rm -rf /", /blocked by safety denylist/.test(last.content), last.content); break;
        case "c6": check("sandbox blocks path escape", /outside the working directory sandbox/i.test(last.content), last.content); break;
      }
    }
    this.step++;
    return Promise.resolve(response);
  },
};

const state = createAgentState("smoke-test system prompt");
const printed = [];
await runTurn(
  state,
  "run the smoke sequence",
  fakeClient,
  config,
  { root: sandboxRoot, commandTimeoutMs: 30_000 },
  { yolo: true }, // non-interactive: auto-approve
  { print: (t) => printed.push(t) }
);

check("loop ended with final text", printed.includes("All checks done."));
check("world state tracked file", state.world.filesTouched.has("hello.txt"));
check("world state tracked commands", state.world.commandsRun.length === 2);
check("world state tracked bg commands array exists", Array.isArray(state.world.bgCommandsRun ?? []));

// Direct sandbox unit check (absolute path escape)
let threw = false;
try {
  resolveInSandbox({ root: sandboxRoot, commandTimeoutMs: 0 }, "C:\\Windows\\system32");
} catch {
  threw = true;
}
check("sandbox rejects absolute outside path", threw);

// Background command smoke (host mode only)
const bgCtx = { root: sandboxRoot, commandTimeoutMs: 5_000, execMode: "host" };
const started = await executeTool("run_command_bg", { command: "node -e \"setTimeout(()=>console.log('bg-ok'),200)\"" }, bgCtx);
check("run_command_bg starts", /Started command/.test(started), started);
const id = (started.match(/Started command ([0-9a-f]+)/) || [])[1];
if (id) {
  let done = false;
  for (let i = 0; i < 20; i++) {
    const status = await executeTool("check_command", { id }, bgCtx);
    if (/status: exited/.test(status)) {
      done = /bg-ok/.test(status);
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  check("check_command sees completion", done);
} else {
  check("check_command sees completion", false, "no id parsed");
}

fs.rmSync(sandboxRoot, { recursive: true, force: true });
console.log(results.join("\n"));
console.log(failures === 0 ? "\nSMOKE OK" : `\nSMOKE FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
