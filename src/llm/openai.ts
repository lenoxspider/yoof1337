import type {
  ChatMessage,
  LlmClient,
  LlmResponse,
  ToolCallRequest,
  ToolDefinition,
} from "./client.js";
import type { ProviderConfig } from "../config.js";

/**
 * Adapter for any OpenAI-compatible /v1/chat/completions endpoint.
 * Used directly for OpenAI (gpt-4o-mini) and reused by the llama.cpp
 * adapter, since llama.cpp's server speaks the same wire format.
 */
export class OpenAiCompatibleClient implements LlmClient {
  readonly model: string;
  readonly contextWindow: number;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly providerOpts: ProviderConfig;

  constructor(provider: ProviderConfig, opts: { requireApiKey: boolean }) {
    this.model = provider.model;
    this.contextWindow = provider.contextWindow;
    this.baseUrl = provider.baseUrl.replace(/\/+$/, "");
    this.apiKey = provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined;
    this.providerOpts = provider;
    if (opts.requireApiKey && provider.apiKeyEnv && !this.apiKey) {
      throw new Error(
        `Missing API key: set the ${provider.apiKeyEnv} environment variable (never commit keys to source control).`
      );
    }
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map(toWireMessage),
    };
    if (this.providerOpts.temperature !== undefined) body.temperature = this.providerOpts.temperature;
    if (this.providerOpts.top_p !== undefined) body.top_p = this.providerOpts.top_p;
    if (this.providerOpts.top_k !== undefined) body.top_k = this.providerOpts.top_k;
    if (this.providerOpts.min_p !== undefined) body.min_p = this.providerOpts.min_p;
    if (this.providerOpts.presence_penalty !== undefined) body.presence_penalty = this.providerOpts.presence_penalty;
    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
    }

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`LLM request failed (${res.status} ${res.statusText}): ${detail.slice(0, 2000)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error(`LLM response had no choices: ${JSON.stringify(data).slice(0, 500)}`);

    let toolCalls: ToolCallRequest[] = (message.tool_calls ?? []).map((tc, i) => ({
      id: tc.id ?? `call_${i}`,
      name: tc.function?.name ?? "",
      input: safeParseJson(tc.function?.arguments ?? "{}"),
    }));

    // Compatibility fallback: some OpenAI-compatible servers (including some llama.cpp configs)
    // may return tool call intent as plain assistant content instead of `tool_calls`.
    if (toolCalls.length === 0 && typeof message.content === "string") {
      const inferred = inferToolCallFromContent(message.content);
      if (inferred) toolCalls = [{ id: "call_0", name: inferred.name, input: inferred.input }];
    }

    return { text: message.content ?? null, toolCalls };
  }
}

function toWireMessage(m: ChatMessage): Record<string, unknown> {
  switch (m.role) {
    case "system":
    case "user":
      return { role: m.role, content: m.content };
    case "assistant": {
      const wire: Record<string, unknown> = { role: "assistant", content: m.content };
      if (m.toolCalls && m.toolCalls.length > 0) {
        wire.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
        }));
      }
      return wire;
    }
    case "tool":
      return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  }
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function inferToolCallFromContent(
  content: string
): { name: string; input: Record<string, unknown> } | null {
  // Example observed from llama.cpp:
  //   {{"name": "read_file", "arguments": {"path": "sample.txt"}}}
  // Also handle single-brace JSON: {"name":"...", "arguments":{...}}
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = content.slice(start, end + 1);

  // Some servers wrap JSON in double braces; normalize to a single JSON object.
  const normalized = slice.replace(/^\{\{/, "{").replace(/\}\}$/, "}").trim();
  let parsed: any;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    // Sometimes arguments may be a JSON string inside the object; try to salvage by removing leading/trailing braces noise.
    return null;
  }

  const name = typeof parsed?.name === "string" ? parsed.name : null;
  const args = parsed?.arguments;
  const input = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : safeParseJson(String(args ?? "{}"));
  if (!name) return null;
  return { name, input };
}

export function createOpenAiClient(provider: ProviderConfig): LlmClient {
  return new OpenAiCompatibleClient(provider, { requireApiKey: true });
}
