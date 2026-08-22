import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface ProviderConfig {
  baseUrl: string;
  model: string;
  apiKeyEnv: string | null;
  apiKey?: string;
  contextWindow: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  presence_penalty?: number;
  /** Enable strict JSON schema enforcement on tool call arguments (llama.cpp grammar decoding). */
  strictToolSchemas?: boolean;
  /** tool_choice value: "auto" (default), "required", or "none". */
  toolChoice?: "auto" | "required" | "none";
}

export interface CompactionConfig {
  /** Fraction of the context window at which auto-compaction triggers (e.g. 0.75). */
  thresholdRatio: number;
  /** How many trailing messages to keep verbatim after compaction. */
  keepLastMessages: number;
  /** Whether to snip zombie messages and stale markers before compacting. */
  useHistorySnip: boolean;
  /** Whether to merge consecutive messages to save framing tokens. */
  useContextCollapse: boolean;
}

export interface PermissionRules {
  alwaysAllow: string[];
  alwaysDeny: string[];
  alwaysAsk: string[];
  allowedDomains: string[];
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  transport?: "stdio" | "sse" | "ws" | "http" | "sdk";
  url?: string; // for sse/ws/http
}

export interface AgentConfig {
  provider: string;
  providers: Record<string, ProviderConfig>;
  compaction: CompactionConfig;
  maxToolIterationsPerTurn: number;
  commandTimeoutMs: number;
  hooks: {
    preToolUse: Record<string, string>;
  };
  permissions: PermissionRules;
  mcpServers?: Record<string, McpServerConfig>;
}

const DEFAULTS: AgentConfig = {
  provider: "openai",
  providers: {
    openai: {
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKeyEnv: "OPENAI_API_KEY",
      contextWindow: 128000,
    },
    llamacpp: {
      baseUrl: "http://219.122.229.5:45965/v1",
      model: "Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive-Q8_0.gguf",
      apiKeyEnv: null,
      contextWindow: 131072,
      temperature: 0.6,
      top_p: 0.95,
      top_k: 20,
      min_p: 0,
      presence_penalty: 0,
      strictToolSchemas: true,
      toolChoice: "auto",
    },
    logfare: {
      baseUrl: "https://logfare.ai/v1",
      model: "kimi-k2.5",
      apiKeyEnv: "LOGFARE_API_KEY",
      contextWindow: 131072,
      temperature: 0.6,
      top_p: 0.95,
      top_k: 20,
      min_p: 0,
      presence_penalty: 0,
      strictToolSchemas: false,
      toolChoice: "auto",
    },
    messiah: {
      baseUrl: "https://gfqwqlrmtlkcgyzzhvio.supabase.co/functions/v1/api-v1-chat",
      model: "god-v4-pro",
      apiKeyEnv: "MESSIAH_KEY",
      contextWindow: 128000,
    },
  },
  compaction: { thresholdRatio: 0.75, keepLastMessages: 8, useHistorySnip: true, useContextCollapse: true },
  maxToolIterationsPerTurn: 50,
  commandTimeoutMs: 120_000,
  hooks: { preToolUse: {} },
  permissions: {
    alwaysAllow: ["read_file", "list_dir", "search_code", "grep_search", "web_search", "task_get", "task_list", "task_output", "mcp_list_resources", "mcp_read_resource"],
    alwaysDeny: ["rm -rf /", "rm -rf *"],
    alwaysAsk: [],
    allowedDomains: ["github.com", "stackoverflow.com", "docs.python.org", "developer.mozilla.org"],
  },
};

export function loadConfig(configPath?: string): AgentConfig {
  const homeDir = os.homedir();
  const candidates = configPath
    ? [configPath]
    : [
        path.join(process.cwd(), "yoof1337.json"),
        path.join(process.cwd(), "config.json"),
        path.join(homeDir, ".yoof1337.json"),
        path.join(homeDir, "yoof1337.json"),
        path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), "../config.json"),
      ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const raw = JSON.parse(fs.readFileSync(candidate, "utf8"));
      return {
        ...DEFAULTS,
        ...raw,
        providers: { ...DEFAULTS.providers, ...(raw.providers ?? {}) },
        compaction: { ...DEFAULTS.compaction, ...(raw.compaction ?? {}) },
        hooks: { ...DEFAULTS.hooks, ...(raw.hooks ?? {}) },
        permissions: { ...DEFAULTS.permissions, ...(raw.permissions ?? {}) },
      };
    }
  }
  return DEFAULTS;
}

export function resolveProvider(config: AgentConfig, override?: string): ProviderConfig {
  const name = override ?? config.provider;
  const provider = config.providers[name];
  if (!provider) {
    throw new Error(
      `Unknown provider "${name}". Available: ${Object.keys(config.providers).join(", ")}`
    );
  }
  return provider;
}
