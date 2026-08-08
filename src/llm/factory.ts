import type { AgentConfig } from "../config.js";
import { resolveProvider } from "../config.js";
import type { LlmClient } from "./client.js";
import { createOpenAiClient } from "./openai.js";
import { createLlamaCppClient } from "./llamacpp.js";

export function createClient(config: AgentConfig, providerOverride?: string): LlmClient {
  const name = providerOverride ?? config.provider;
  const provider = resolveProvider(config, name);
  switch (name) {
    case "openai":
    case "messiah":
      return createOpenAiClient(provider);
    case "llamacpp":
      return createLlamaCppClient(provider);
    default:
      // Any other configured provider is assumed OpenAI-compatible.
      return createLlamaCppClient(provider);
  }
}
