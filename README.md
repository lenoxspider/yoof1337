# yoof1337

Terminal-based coding agent: an LLM in a tool-use loop that can read/write files, run shell commands, and search code inside a sandboxed working directory, with human-in-the-loop guardrails for anything that mutates state.

## Setup

```sh
npm install
npm run build
```

Set your API key via environment variable (never committed):

```sh
export OPENAI_API_KEY=sk-...
```

Or put it in a local `.env` file (also never committed):

```ini
OPENAI_API_KEY=sk-...
```

## Run

```sh
node dist/cli/index.js [--dir <sandbox-path>] [--provider openai|llamacpp] [--yolo]
# or during development:
npm run dev
```

- `--dir` -- the working-directory sandbox. All file operations and commands are scoped here; paths that resolve outside it are rejected.
- `--provider` -- which block of `config.json` to use. `openai` (gpt-4o-mini, testing phase) or `llamacpp` (self-hosted Qwen3.5-35B-A3B via llama.cpp's OpenAI-compatible server). Swapping providers is config only -- base URL + model name -- thanks to the adapter layer in `src/llm/`.
- `--yolo` -- explicit opt-in to auto-approve every tool call, including `write_file` and `run_command`. Off by default; without it, each mutating call shows you exactly what will run/change and asks for confirmation. `read_file`, `list_directory`, and `search_code` are always auto-approved.

In-session commands: `/compact` (summarize + shrink history), `/state` (world-state tracker + token estimate), `/help`, `/exit`.

## Context compaction

When the estimated history size passes `compaction.thresholdRatio` (default 0.75) of the provider's context window, the agent auto-compacts: the LLM summarizes the history (preserving decisions, file states, unresolved tasks), and the log is rebuilt as `[system prompt, original task verbatim, summary, last N messages verbatim]`. The system prompt and original task are never summarized. A separate world-state tracker (files touched, commands run) lives outside the message log, so compaction is never the only record of what happened.

## Sandboxing notes

Defense layers, weakest to strongest:

1. **Denylist** (`src/tools/runCommand.ts`) -- blocks obviously destructive patterns (`rm -rf /`, fork bombs, device writes). A safety net only.
2. **Permission prompts** -- every `run_command`/`write_file` requires explicit approval unless `--yolo`.
3. **Path sandbox** -- all file tools resolve paths against `--dir` and reject escapes.
4. **Container mode (default for `run_command`)** -- `run_command` runs inside Docker by default when available. Use `--unsafe-host` only if you explicitly want host execution.
5. **Recommended: containerize the whole agent** -- for real isolation, run the entire CLI inside Docker, e.g.:

```sh
docker run -it --rm -v "$PWD:/work" -w /work node:22 bash -c "npm ci && npm run build && node dist/cli/index.js --dir /work"
```

## llama.cpp / GPU migration

Serve the GGUF model with llama.cpp's OpenAI-compatible server on the GPU box:

```sh
llama-server -m qwen3.5-35b-a3b-q8_0.gguf --port 8080 -c 262144 --jinja
```

Then either set `"provider": "llamacpp"` in `config.json` or pass `--provider llamacpp`, and point `providers.llamacpp.baseUrl` at the instance. No code changes.

## Test

```sh
npm run smoke
```

Runs the compiled agent loop offline against a scripted fake LLM client -- verifies a full tool-call cycle, error surfacing, the denylist, and sandbox escapes, with no API key needed.

## Layout

```
src/
├── llm/          client.ts (provider-agnostic interface), openai.ts, llamacpp.ts, factory.ts
├── tools/        definitions.ts (schemas + registry), one file per tool, sandbox.ts
├── loop/         agentLoop.ts, compaction.ts, state.ts (world-state tracker)
├── permissions/  guardrails.ts
└── cli/          index.ts (entry point / REPL)
```
