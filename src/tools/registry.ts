import type { ToolDefinition } from "../llm/client.js";
import type { SandboxContext } from "./sandbox.js";

export type Executor = (input: Record<string, unknown>, ctx: SandboxContext) => Promise<string>;

export interface RegisteredTool {
  definition: ToolDefinition;
  execute: Executor;
  mutating: boolean;
  category?: string;
}

export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  register(tool: RegisteredTool): void {
    this.tools.set(tool.definition.name, tool);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  getAll(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  getCategory(category: string): RegisteredTool[] {
    return this.getAll().filter(t => t.category === category);
  }

  search(query: string): RegisteredTool[] {
    const q = query.toLowerCase();
    return this.getAll().filter(t => 
      t.definition.name.toLowerCase().includes(q) || 
      t.definition.description.toLowerCase().includes(q)
    );
  }
}

export const registry = new ToolRegistry();
