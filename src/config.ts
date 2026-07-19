import fs from "node:fs";
import path from "node:path";

export interface ProviderConfig {
  baseUrl: string;
  model: string;
  apiKeyEnv: string | null;
  contextWindow: number;
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
      contextWindow: 128_000,
    },
    llamacpp: {
      baseUrl: "http://localhost:8080/v1",
      model: "qwen3.5-35b-a3b",
      apiKeyEnv: null,
      contextWindow: 262_144,
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
  const candidates = configPath
    ? [configPath]
    : [
        path.join(process.cwd(), "yoof1337.json"),
        path.join(process.cwd(), "config.json")
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
