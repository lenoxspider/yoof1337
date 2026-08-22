# yoof1337

Terminal-based coding agent: an LLM in a tool-use loop that can read/write files, run shell commands, and search code inside a sandboxed working directory, with human-in-the-loop guardrails for anything that mutates state and a split-pane terminal dashboard.

## Setup

```sh
npm install
npm run build
```

Set your API key via environment variable:

```sh
export OPENAI_API_KEY=sk-...
```

Or put it in a local `.env` file (ignored by Git):

```ini
OPENAI_API_KEY=sk-...
```

## Run

```sh
node dist/cli/index.js [--dir <sandbox-path>] [--provider openai|llamacpp] [-a untrusted|on-request|never] [--yolo] [--tui]
```

- `--dir` -- The working-directory sandbox. All file operations and commands are scoped here; paths that resolve outside it are rejected.
- `--provider` -- Which block of `config.json` to use. `openai` (e.g. `gpt-4o-mini`, `gpt-4o`) or `llamacpp` (self-hosted Qwen3.5-35B-A3B via llama.cpp's OpenAI-compatible server). Swapping providers is config only -- base URL + model name -- thanks to the adapter layer in `src/llm/`.
- `-a, --ask-for-approval` -- Approval policy for mutating tool calls: `on-request` (default), `untrusted`, `never`.
- `--yolo` -- Explicit opt-in to auto-approve every tool call, including `write_file` and `run_command`. Off by default; without it, each mutating call shows you exactly what will run/change and asks for confirmation. `read_file`, `list_directory`, and `search_code` are always auto-approved.
- `--tui` -- Opt in to the interactive Ink TUI dashboard (split-pane transcript + status/tools panel). By default the agent runs in a plain line-based REPL for maximum terminal compatibility.

In-session slash commands: `/compact` (summarize + shrink history), `/state` (world-state tracker + token estimate), `/sessions`, `/resume`, `/save`, `/help`, `/exit`.

## Terminal Dashboard (TUI)

When launched with `--tui`, `yoof1337` renders a dual-pane dashboard with a curated 256-color palette:

- **Split-Pane Layout**: Scrollable conversation transcript on the left, status and tool execution history on the right.
- **Collapsible Sidebar**: Press `Ctrl+B` to collapse or expand the info panel. On narrow terminals (< 80 columns), it automatically falls back to a clean single-column layout.
- **Hotkey Legend & Navigation**:
  - `Ctrl+B` -- Toggle sidebar panel
  - `Ctrl+O` -- Open full-screen expanded output modal
  - `Ctrl+T` -- Open full-screen transcript modal
  - `PgUp` / `PgDn` -- Scroll transcript viewport
  - `Shift+Up` / `Shift+Down` -- Scroll viewport 1 line
  - `Tab` / `Right Arrow` -- Autocomplete slash commands
  - `Ctrl+A` / `Ctrl+E` -- Jump to start / end of input line
  - `Ctrl+U` / `Ctrl+K` -- Clear whole line / to end of line
  - `Ctrl+C` -- Quit session

## Features

- **Prompt Queue:** In-session interactive prompt queueing allowing for rapid commands while agent is processing.
- **Web Tools:** Integrated `web_search` and `web_fetch` capabilities.
- **Autonomous Subagents:** Spawn isolated concurrent subagents on isolated git worktrees via the Job Board Coordinator. Subagents have distinct short-term memories preventing context bloat.
- **Intel on Demand:** Drop markdown context into `.yoof1337-mem` for on-demand knowledge injection (`intel_day`).
- **Persistent Tasks:** Tasks and subagent states are backed to `.yoof1337-tasks.json` allowing for session resumes and dependency graphing.

## Configuration

The agent respects a `config.json` or `yoof1337.json` file in the working directory. Here you can change default settings and define LLM generation properties.

```json
{
  "provider": "openai",
  "providers": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "model": "gpt-4o-mini",
      "apiKeyEnv": "OPENAI_API_KEY",
      "contextWindow": 128000
    },
    "llamacpp": {
      "baseUrl": "http://localhost:8080/v1",
      "model": "qwen3.5-35b-a3b",
      "contextWindow": 131072,
      "temperature": 0.6,
      "top_p": 0.95,
      "top_k": 20,
      "min_p": 0,
      "presence_penalty": 0
    }
  }
}
```

## Context compaction

When the estimated history size passes `compaction.thresholdRatio` (default 0.75) of the provider's context window, the agent auto-compacts: the LLM summarizes the history (preserving decisions, file states, unresolved tasks), and the log is rebuilt as `[system prompt, original task verbatim, summary, last N messages verbatim]`. The system prompt and original task are never summarized. A separate world-state tracker (files touched, commands run) lives outside the message log, so compaction is never the only record of what happened.

## Sandboxing notes

Defense layers, weakest to strongest:

1. **Denylist** (`src/tools/runCommand.ts`) -- blocks obviously destructive patterns (`rm -rf /`, fork bombs, device writes). A safety net only.
2. **Permission prompts** -- every `run_command`/`write_file` requires explicit approval unless `--yolo`.
3. **Path sandbox** -- all file tools resolve paths against `--dir` and reject escapes.
4. **Container mode (opt-in)** -- run with `--docker` to execute `run_command` inside Docker for better isolation.
5. **Recommended: containerize the whole agent** -- for real isolation, run the entire CLI inside Docker:

```sh
docker run -it --rm -v "$PWD:/work" -w /work node:22 bash -c "npm ci && npm run build && node dist/cli/index.js --dir /work"
```

## Layout

```
src/
├── llm/          client.ts (provider-agnostic interface), openai.ts, llamacpp.ts, factory.ts
├── tools/        definitions.ts (schemas + registry), one file per tool, sandbox.ts
├── tasks/        coordinator.ts, taskStore.ts, teamManager.ts, workerProcess.ts
├── loop/         agentLoop.ts, compaction.ts, state.ts (world-state tracker)
├── permissions/  guardrails.ts
├── hooks/        useViewport.ts
├── components/   AnsiLog.tsx, OverlayModal.tsx
└── cli/          index.ts (entry point / REPL), inkUi.tsx (split-pane dashboard), markdown.ts, ui.ts
```
