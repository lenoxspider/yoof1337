import type {
  ChatMessage,
  LlmClient,
  LlmResponse,
  ToolCallRequest,
  ToolDefinition,
} from "./client.js";
import type { ProviderConfig } from "../config.js";
import { toStrictSchema } from "./schemaStrict.js";

/**
 * Adapter for any OpenAI-compatible /v1/chat/completions endpoint.
 * Used directly for OpenAI (gpt-4o-mini) and reused by the llama.cpp
 * adapter, since llama.cpp's server speaks the same wire format.
 */
export class OpenAiCompatibleClient implements LlmClient {
  readonly model: string;
  readonly contextWindow: number;
  readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly providerOpts: ProviderConfig;

  constructor(provider: ProviderConfig, opts: { requireApiKey: boolean }) {
    this.model = provider.model;
    this.contextWindow = provider.contextWindow;
    this.baseUrl = provider.baseUrl.replace(/\/+$/, "");
    this.apiKey = provider.apiKey || (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined);
    this.providerOpts = provider;
    if (opts.requireApiKey && !this.apiKey) {
      const details = provider.apiKeyEnv
        ? `set the ${provider.apiKeyEnv} environment variable or provide apiKey in config`
        : `provide apiKey in config`;
      throw new Error(
        `Missing API key: ${details} (never commit keys to public source control).`
      );
    }
  }

  async checkHealth(): Promise<{ ok: boolean; message: string; models?: string[] }> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
      const res = await fetch(`${this.baseUrl}/models`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        return { ok: false, message: `HTTP ${res.status}: ${res.statusText}` };
      }
      const data = (await res.json()) as any;
      const modelList = Array.isArray(data?.data) ? data.data.map((m: any) => m.id ?? m) : [];
      return {
        ok: true,
        message: `Online (${modelList.length} model(s) available)`,
        models: modelList,
      };
    } catch (err: any) {
      return { ok: false, message: `Unreachable: ${err.message}` };
    }
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[], abortSignal?: AbortSignal): Promise<LlmResponse> {
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
      const useStrict = this.providerOpts.strictToolSchemas ?? false;
      body.tools = tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: useStrict ? toStrictSchema(t.inputSchema) : t.inputSchema,
          ...(useStrict ? { strict: true } : {}),
        },
      }));
      const toolChoice = this.providerOpts.toolChoice ?? "auto";
      body.tool_choice = toolChoice;
    }

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: abortSignal,
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
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error(`LLM response had no choices: ${JSON.stringify(data).slice(0, 500)}`);

    let toolCalls: ToolCallRequest[] = (message.tool_calls ?? []).map((tc, i) => ({
      id: tc.id ?? `call_${i}`,
      name: tc.function?.name ?? "",
      input: safeParseJson(tc.function?.arguments ?? "{}"),
    }));

    let assistantContent = message.content ?? null;

    // Compatibility fallback: some OpenAI-compatible servers (including llama.cpp, Qwen, DeepSeek)
    // may stream tool calls as text tags (<tool_call>...</tool_call> or markdown JSON) instead of native tool_calls.
    if (toolCalls.length === 0 && typeof assistantContent === "string" && assistantContent.trim()) {
      const extracted = extractToolCallsFromText(assistantContent);
      if (extracted.toolCalls.length > 0) {
        toolCalls = extracted.toolCalls;
        assistantContent = extracted.cleanedText || null;
      }
    }

    const usage = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
          totalTokens:
            data.usage.total_tokens ??
            (data.usage.prompt_tokens ?? 0) + (data.usage.completion_tokens ?? 0),
        }
      : undefined;

    return { text: assistantContent, toolCalls, usage };
  }

  async chatStream(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    onChunk: (chunk: string) => void,
    abortSignal?: AbortSignal
  ): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map(toWireMessage),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (this.providerOpts.temperature !== undefined) body.temperature = this.providerOpts.temperature;
    if (this.providerOpts.top_p !== undefined) body.top_p = this.providerOpts.top_p;
    if (this.providerOpts.top_k !== undefined) body.top_k = this.providerOpts.top_k;
    if (this.providerOpts.min_p !== undefined) body.min_p = this.providerOpts.min_p;
    if (this.providerOpts.presence_penalty !== undefined) body.presence_penalty = this.providerOpts.presence_penalty;
    if (tools.length > 0) {
      const useStrict = this.providerOpts.strictToolSchemas ?? false;
      body.tools = tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: useStrict ? toStrictSchema(t.inputSchema) : t.inputSchema,
          ...(useStrict ? { strict: true } : {}),
        },
      }));
      const toolChoice = this.providerOpts.toolChoice ?? "auto";
      body.tool_choice = toolChoice;
    }

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: abortSignal,
      });
    } catch {
      // Fallback to non-streaming if network error
      return this.chat(messages, tools, abortSignal);
    }

    if (!res.ok || !res.body) {
      return this.chat(messages, tools, abortSignal);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let accumulatedContent = "";
    const rawToolCalls: Record<number, { id?: string; name?: string; arguments: string }> = {};
    let finalUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":") || trimmed === "data: [DONE]") continue;
          if (trimmed.startsWith("data: ")) {
            const jsonStr = trimmed.slice(6);
            try {
              const chunk = JSON.parse(jsonStr);
              const choice = chunk.choices?.[0];
              const delta = choice?.delta;

              if (delta?.content) {
                accumulatedContent += delta.content;
                onChunk(delta.content);
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  if (!rawToolCalls[idx]) {
                    rawToolCalls[idx] = { id: tc.id, name: tc.function?.name ?? "", arguments: "" };
                  }
                  if (tc.id) rawToolCalls[idx].id = tc.id;
                  if (tc.function?.name) rawToolCalls[idx].name = tc.function.name;
                  if (tc.function?.arguments) rawToolCalls[idx].arguments += tc.function.arguments;
                }
              }

              if (chunk.usage) {
                finalUsage = {
                  promptTokens: chunk.usage.prompt_tokens ?? 0,
                  completionTokens: chunk.usage.completion_tokens ?? 0,
                  totalTokens: chunk.usage.total_tokens ?? 0,
                };
              }
            } catch {
              // Ignore chunk parse errors
            }
          }
        }
      }
    } catch {
      if (accumulatedContent.length === 0 && Object.keys(rawToolCalls).length === 0) {
        return this.chat(messages, tools, abortSignal);
      }
    }

    let toolCalls: ToolCallRequest[] = Object.values(rawToolCalls).map((tc, i) => ({
      id: tc.id ?? `call_${i}`,
      name: tc.name ?? "",
      input: safeParseJson(tc.arguments || "{}"),
    }));

    let assistantContent = accumulatedContent || null;

    // Fallback extraction for open models
    if (toolCalls.length === 0 && typeof assistantContent === "string" && assistantContent.trim()) {
      const extracted = extractToolCallsFromText(assistantContent);
      if (extracted.toolCalls.length > 0) {
        toolCalls = extracted.toolCalls;
        assistantContent = extracted.cleanedText || null;
      }
    }

    return {
      text: assistantContent,
      toolCalls,
      usage: finalUsage,
    };
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
    console.warn(`[llm] Failed to parse tool arguments JSON: ${raw.slice(0, 200)}`);
    return {};
  }
}

function extractToolCallsFromText(content: string): { toolCalls: ToolCallRequest[]; cleanedText: string } {
  const toolCalls: ToolCallRequest[] = [];
  let cleanedText = content;

  // 1. Match XML <tool_call>...</tool_call> blocks (common in Qwen, Hermès, DeepSeek)
  const toolCallTagRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  let match: RegExpExecArray | null;
  while ((match = toolCallTagRegex.exec(content)) !== null) {
    const raw = match[1].trim();
    const parsed = parsePotentialToolJson(raw);
    if (parsed) {
      toolCalls.push({
        id: `call_${toolCalls.length}`,
        name: parsed.name,
        input: parsed.input,
      });
    }
  }

  if (toolCalls.length > 0) {
    cleanedText = cleanedText.replace(toolCallTagRegex, "").trim();
    return { toolCalls, cleanedText };
  }

  // 2. Match Markdown fenced ```json ... ``` blocks containing tool calls
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const raw = match[1].trim();
    const parsed = parsePotentialToolJson(raw);
    if (parsed) {
      toolCalls.push({
        id: `call_${toolCalls.length}`,
        name: parsed.name,
        input: parsed.input,
      });
    }
  }

  if (toolCalls.length > 0) {
    cleanedText = cleanedText.replace(codeBlockRegex, "").trim();
    return { toolCalls, cleanedText };
  }

  // 3. Match raw JSON object { "name": "...", "arguments": { ... } } or { "tool": "...", "parameters": { ... } }
  const parsed = parsePotentialToolJson(content);
  if (parsed) {
    toolCalls.push({
      id: "call_0",
      name: parsed.name,
      input: parsed.input,
    });
    cleanedText = "";
  }

  return { toolCalls, cleanedText };
}

function parsePotentialToolJson(raw: string): { name: string; input: Record<string, unknown> } | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = raw.slice(start, end + 1).replace(/^\{\{/, "{").replace(/\}\}$/, "}").trim();

  let parsed: any;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;

  // Pattern A: {"name": "read_file", "arguments": {...}}
  if (typeof parsed.name === "string") {
    const args = parsed.arguments ?? parsed.parameters ?? parsed.input ?? {};
    const input = typeof args === "object" && args !== null ? args : safeParseJson(String(args));
    return { name: parsed.name, input };
  }

  // Pattern B: {"tool": "read_file", "parameters": {...}}
  if (typeof parsed.tool === "string") {
    const args = parsed.parameters ?? parsed.arguments ?? parsed.input ?? {};
    const input = typeof args === "object" && args !== null ? args : safeParseJson(String(args));
    return { name: parsed.tool, input };
  }

  // Pattern C: {"action": "read_file", "action_input": {...}}
  if (typeof parsed.action === "string") {
    const args = parsed.action_input ?? parsed.parameters ?? parsed.arguments ?? {};
    const input = typeof args === "object" && args !== null ? args : safeParseJson(String(args));
    return { name: parsed.action, input };
  }

  return null;
}

export function createOpenAiClient(provider: ProviderConfig): LlmClient {
  return new OpenAiCompatibleClient(provider, { requireApiKey: true });
}
