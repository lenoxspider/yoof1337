import type { LlmClient } from "./client.js";
import type { ProviderConfig } from "../config.js";
import { OpenAiCompatibleClient } from "./openai.js";

/**
 * Adapter for a self-hosted llama.cpp server (e.g. Qwen3.5-35B-A3B GGUF)
 * exposing the OpenAI-compatible /v1/chat/completions endpoint.
 * The wire format is identical to OpenAI's, so this reuses that client;
 * the only difference is that no API key is required for a local server.
 */
export function createLlamaCppClient(provider: ProviderConfig): LlmClient {
  return new OpenAiCompatibleClient(provider, { requireApiKey: false });
}
