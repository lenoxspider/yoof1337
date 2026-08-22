# yoof1337

A terminal-first, sandboxed autonomous AI coding agent designed for local open models (via `llama.cpp`) and frontier cloud APIs (OpenAI). 

Features human-in-the-loop permission guardrails, real-time token streaming, rich 256-color syntax highlighting, dynamic on-demand tool loading, multi-agent orchestration, and a dual-pane terminal TUI dashboard.

---

## ⚡ Quick Start

### 1. Installation

```bash
git clone https://github.com/lenoxspider/yoof1337.git
cd yoof1337
npm install
npm run build
```

### 2. Configuration & API Key

Set your API key via environment variable:

```bash
export OPENAI_API_KEY=sk-...
```

Or configure a local `.env` file:

```ini
OPENAI_API_KEY=sk-...
```

For self-hosted local models on a rented GPU box, run the 1-click bootstrap script:

```bash
chmod +x scripts/setup-gpu.sh
./scripts/setup-gpu.sh
```

---

## 🚀 Running the Agent

```bash
# Launch interactive TUI in current directory
node dist/cli/index.js --tui

# Launch with a specific provider (e.g. local llama.cpp)
node dist/cli/index.js --tui --provider llamacpp

# Run in an isolated sandbox directory with YOLO (auto-approve) mode
node dist/cli/index.js --tui --dir /path/to/project --yolo
```

### CLI Flags

| Flag | Description |
| :--- | :--- |
| **`--dir <path>`** | Sets the sandbox working directory. All file tools and terminal commands are strictly confined here. |
| **`--provider <name>`** | Selects the provider block from `config.json` (e.g. `openai`, `llamacpp`). |
| **`--tui`** | Launches the rich Ink TUI dashboard (split-pane transcript + status/tools panel). |
| **`--plain`** | Forces plain line-based REPL mode for basic terminals or CI environments. |
| **`--yolo`** | Auto-approves all tool calls (including file writes and shell execution). |
| **`-a, --ask-for-approval`** | Approval policy: `on-request` (default), `untrusted`, `never`. |
| **`--resume <id>`** | Resumes an existing session by ID from `.yoof1337-sessions/`. |
| **`--continue`** | Automatically resumes the most recent session in the current directory. |
| **`--docker`** | Executes all shell commands inside an isolated Docker container. |

---

## 🖥️ Terminal Dashboard (TUI) & Ergonomics

When launched with `--tui`, `yoof1337` renders a dual-pane terminal interface:

* **Dual-Pane Interface:** Scrollable transcript on the left; live status, token gauges, and tool output history on the right.
* **Live Token Streaming:** Responses stream word-by-word with instant typing feedback.
* **Syntax Highlighting:** 256-color ANSI syntax highlighting for TypeScript, JavaScript, Python, JSON, Bash, and Unified Git Diffs (`+` green, `-` red, `@@` cyan).
* **Mouse Wheel & Keyboard Scrolling:**
  - **Mouse Wheel Up / Down:** Scroll transcript viewport smoothly.
  - **`PgUp` / `PgDn`**: Page scroll through conversation history.
  - **`Shift+Up` / `Shift+Down`**: Line-by-line fine scrolling.
  - **`Ctrl+B`**: Toggle collapsible sidebar panel.
  - **`Ctrl+O`**: Expand folded tool output in full-screen modal.
  - **`Ctrl+T`**: View full-screen transcript modal.

---

## 💡 Core Features

### 1. `@` File Context Tagging
Mention any file in your prompt using `@` to instantly load its contents into the turn context:
```text
you> Refactor the error handling in @src/tools/definitions.ts
```
*Saves an extra `read_file` round-trip and provides instant responses.*

### 2. Lean Core Tools & On-Demand Activation
* **Default Lean Tools (~8 core tools):** `read_file`, `write_file`, `edit_file`, `list_directory`, `search_code`, `run_command`, `request_tools`, `note_decision`.
* **On-Demand Categories:** The agent or user dynamically activates tool groups as needed (`git`, `gh`, `files`, `tasks`, `web`, `mcp`, `custom`, `all`).
* **Auto-Reset on Compaction:** Specialized tools automatically reset back to lean defaults when history is compacted to prevent schema bloat.

### 3. Open Model Parser Fallback (llama.cpp / Qwen / DeepSeek)
If your open model streams `<tool_call>` XML tags or markdown JSON blocks into plain text, `yoof1337`'s regex fallback engine extracts the tool call and arguments seamlessly without stalling.

### 4. Session Permission Auto-Allow Rules
When prompted for confirmation on mutating actions (`run_command`, `write_file`, `edit_file`, `delete_file`):
* **`[y]` (Once):** Approves this specific execution.
* **`[a]` (Always / Session Rule):** Approves and remembers rules for the session (e.g. auto-allowing all commands starting with `npm test`, `git`, or all edits in the workspace folder).
* **`[n]` (Deny):** Rejects the action.

### 5. Repository Custom Instructions (`AGENTS.md`)
`yoof1337` automatically detects and injects project rules from:
- `AGENTS.md`
- `CLAUDE.md`
- `.cursorrules`
- `.yoof1337/system_prompt.md`

Use `/prompt reload` to refresh instructions on the fly without restarting.

### 6. Dynamic Custom Tool Creation
Define and register new custom tools at runtime:
```json
create_tool({
  "name": "generate_uuid",
  "description": "Generate a random UUID v4",
  "input_schema": { "type": "object", "properties": {} }
})
```
Custom tools persist across sessions in `.yoof1337/custom-tools.json`.

---

## ⌨️ In-Session Slash Commands

Type `/` in the prompt to open the autocomplete menu:

| Command | Description |
| :--- | :--- |
| **`/stats`** | View token throughput (**tokens/sec**), session totals, and cost analytics. |
| **`/permission`** | Change permission mode (`/permission strict`, `/permission auto`, `/permission reset`). |
| **`/tools`** | List active/inactive tool categories (`/tools reset`, `/tools activate <cat>`, `/tools deactivate <cat>`). |
| **`/prompt`** | View active system prompt and custom instructions (`/prompt reload` to refresh). |
| **`/health`** | Ping the active LLM endpoint and verify model connectivity. |
| **`/tree`** | Display a visual directory tree of the workspace. |
| **`/compact`** | Summarize and compact conversation history to free context space. |
| **`/state`** | Display tracked world-state (touched files, executed commands, decisions ledger). |
| **`/tasks`** | List background sub-agents and active orchestration tasks. |
| **`/model`** | Show active provider/model and context window limit. |
| **`/undo` / `/redo`** | Step backward or forward across automatic Git checkpoints. |
| **`/status` / `/diff`** | Quick git status and unified diff preview. |
| **`/clear`** | Clear the transcript viewport. |
| **`/reset`** | Start a fresh conversation session. |
| **`/exit`** | Quit session safely. |

---

## ⚙️ Configuration (`config.json`)

Configure your LLM endpoints in `config.json`:

```json
{
  "provider": "llamacpp",
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
  },
  "compaction": {
    "thresholdRatio": 0.75,
    "keepLastMessages": 4
  }
}
```

---

## 🧠 Multi-Agent Orchestration

`yoof1337` can spawn background sub-agents and teams for complex workflows:
* **`agent_run`**: Spawns an asynchronous sub-agent with a custom persona/system prompt on an isolated Git worktree.
* **`task_create` / `task_get` / `task_output`**: Tracks background task queues with dependency graphing.
* **`team_create`**: Coordinates multi-agent teams with shared system instructions.

---

## 🛡️ Sandbox & Security Layers

1. **Denylist Protection**: Blocks destructive root operations (`rm -rf /`, raw disk writes, fork bombs).
2. **Strict Path Sandbox**: Resolves all file operations relative to `--dir` and rejects traversal escapes (`../`).
3. **Session Permissions**: Human-in-the-loop approval on all file mutations and shell executions.
4. **Docker Containerization (Optional)**: Execute commands inside isolated containers via `--docker`.

---

## 📁 Repository Layout

```
yoof1337/
├── src/
│   ├── cli/             # Entry point, Ink TUI dashboard, syntax highlighting, file tagger, markdown
│   ├── config/          # Configuration and AGENTS.md prompt loader
│   ├── llm/             # Provider-agnostic LLM interface, OpenAI/llama.cpp clients, streaming
│   ├── loop/            # Agent loop, compaction engine, world-state tracker
│   ├── permissions/     # Human-in-the-loop guardrails & session auto-allow rules
│   ├── tasks/           # Multi-agent coordinator, task store, team manager, worker processes
│   └── tools/           # Tool registry, lean definitions, sandboxing, dynamic tools
├── scripts/
│   ├── setup-gpu.sh     # 1-click CUDA/llama.cpp bootstrap script for rented GPUs
│   └── provision-tools.sh # Environment provisioning for custom tools
└── config.json          # Provider configurations & hyperparameters
```

---

## 📄 License

MIT © [lenoxspider](https://github.com/lenoxspider)
