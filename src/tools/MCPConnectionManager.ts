import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AgentConfig, McpServerConfig } from "../config.js";
import { registry } from "./registry.js";
import type { SandboxContext } from "./sandbox.js";

// Dummy auth configs as requested by user
interface McpOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export class MCPConnectionManager {
  private clients = new Map<string, Client>();
  private reconnectTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(private config: AgentConfig) {}

  async initialize(): Promise<void> {
    if (!this.config.mcpServers) return;

    for (const [name, serverConfig] of Object.entries(this.config.mcpServers)) {
      await this.connectServer(name, serverConfig);
    }
  }

  private async connectServer(name: string, config: McpServerConfig, retryCount = 0): Promise<void> {
    try {
      let transport;

      // Dummy Auth Flows Implementation (per user request)
      const headers: Record<string, string> = {};
      if (config.env?.API_KEY) {
        headers["Authorization"] = `Bearer ${config.env.API_KEY}`;
      } else if (config.env?.OAUTH_CLIENT_ID) {
        // Dummy OAuth flow
        headers["Authorization"] = `Bearer dummy_oauth_token_for_${name}`;
      } else if (config.env?.XAA_TOKEN) {
        // Dummy Cross-App Access (XAA / SEP-990)
        headers["X-App-Access"] = config.env.XAA_TOKEN;
      }

      if (config.transport === "stdio" || !config.transport) {
        transport = new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
          env: { ...process.env, ...(config.env ?? {}) } as any,
        });
      } else if (config.transport === "sse") {
        // TODO: Implement SSE transport once added to SDK, or use HTTP
        throw new Error("SSE transport not yet supported in this wrapper");
      } else {
        throw new Error(`Unsupported transport: ${config.transport}`);
      }

      const client = new Client(
        { name: "yoof1337-client", version: "1.0.0" },
        { capabilities: {} }
      );

      await client.connect(transport);
      this.clients.set(name, client);

      // Register tools exposed by the server
      const toolsResult = await client.listTools();
      for (const tool of toolsResult.tools) {
        const toolName = `mcp__${name}__${tool.name}`;
        registry.register({
          mutating: true, // assume mutating to be safe, rely on user approval
          category: `MCP: ${name}`,
          definition: {
            name: toolName,
            description: `[MCP: ${name}] ${tool.description ?? tool.name}`,
            inputSchema: tool.inputSchema as Record<string, unknown>,
          },
          execute: async (input: Record<string, unknown>, ctx: SandboxContext) => {
            const result = await client.callTool({ name: tool.name, arguments: input });
            if (result.isError) {
              return `MCP Error: ${JSON.stringify(result.content)}`;
            }
            return JSON.stringify(result.content, null, 2);
          },
        });
      }

      // Handle disconnects
      transport.onclose = () => {
        this.clients.delete(name);
        this.scheduleReconnect(name, config, retryCount + 1);
      };

    } catch (err) {
      console.error(`[MCP] Failed to connect to ${name}:`, err);
      this.scheduleReconnect(name, config, retryCount + 1);
    }
  }

  private scheduleReconnect(name: string, config: McpServerConfig, retryCount: number): void {
    if (this.reconnectTimeouts.has(name)) {
      clearTimeout(this.reconnectTimeouts.get(name)!);
    }
    
    // Exponential backoff up to 30s
    const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
    
    const timeout = setTimeout(() => {
      this.connectServer(name, config, retryCount);
    }, delay);
    
    this.reconnectTimeouts.set(name, timeout);
  }

  getClient(name: string): Client | undefined {
    return this.clients.get(name);
  }

  getAllClients(): Map<string, Client> {
    return this.clients;
  }

  async closeAll(): Promise<void> {
    for (const timeout of this.reconnectTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.reconnectTimeouts.clear();
    
    for (const client of this.clients.values()) {
      try {
        await client.close();
      } catch (e) {
        // Ignore close errors
      }
    }
    this.clients.clear();
  }
}

import { loadConfig } from "../config.js";

export const mcpManager = new MCPConnectionManager(loadConfig());
