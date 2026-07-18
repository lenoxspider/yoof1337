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
}

export interface AgentConfig {
  provider: string;
  providers: Record<string, ProviderConfig>;
  compaction: CompactionConfig;
  maxToolIterationsPerTurn: number;
  commandTimeoutMs: number;
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
  compaction: { thresholdRatio: 0.75, keepLastMessages: 8 },
  maxToolIterationsPerTurn: 50,
  commandTimeoutMs: 120_000,
};

export function loadConfig(configPath?: string): AgentConfig {
  const candidates = configPath
    ? [configPath]
    : [path.join(process.cwd(), "config.json")];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const raw = JSON.parse(fs.readFileSync(candidate, "utf8"));
      return {
        ...DEFAULTS,
        ...raw,
        providers: { ...DEFAULTS.providers, ...(raw.providers ?? {}) },
        compaction: { ...DEFAULTS.compaction, ...(raw.compaction ?? {}) },
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
