import type { ToolDefinition } from "../llm/client.js";
import type { SandboxContext } from "./sandbox.js";

export type Executor = (input: Record<string, unknown>, ctx: SandboxContext) => Promise<string>;

export type ToolTier = "core" | "extended";

export interface RegisteredTool {
  definition: ToolDefinition;
  execute: Executor;
  mutating: boolean;
  category?: string;
  tier?: ToolTier;
}

export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();
  private activatedCategories: Set<string> = new Set();

  register(tool: RegisteredTool): void {
    this.tools.set(tool.definition.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  setTier(name: string, tier: ToolTier): void {
    const tool = this.tools.get(name);
    if (tool) tool.tier = tier;
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

  getActiveDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter(t => this.isActive(t))
      .map(t => t.definition);
  }

  activateCategory(category: string): string[] {
    this.activatedCategories.add(category.toUpperCase());
    return this.getCategory(category.toUpperCase()).map(t => t.definition.name);
  }

  deactivateCategory(category: string): void {
    this.activatedCategories.delete(category.toUpperCase());
  }

  activateAll(): void {
    const categories = new Set(this.getAll().map(t => t.category).filter(Boolean));
    for (const cat of categories) this.activatedCategories.add(cat!);
  }

  getActivatedCategories(): string[] {
    return Array.from(this.activatedCategories);
  }

  getAvailableCategories(): { category: string; tools: string[]; active: boolean }[] {
    const catMap = new Map<string, string[]>();
    for (const tool of this.tools.values()) {
      const cat = tool.category ?? "UNCATEGORIZED";
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat)!.push(tool.definition.name);
    }
    return Array.from(catMap.entries()).map(([category, tools]) => ({
      category,
      tools,
      active: this.activatedCategories.has(category) || tools.every(n => this.tools.get(n)?.tier === "core"),
    }));
  }

  getCategory(category: string): RegisteredTool[] {
    return this.getAll().filter(t => (t.category ?? "").toUpperCase() === category.toUpperCase());
  }

  search(query: string): RegisteredTool[] {
    const q = query.toLowerCase();
    return this.getAll().filter(t =>
      t.definition.name.toLowerCase().includes(q) ||
      t.definition.description.toLowerCase().includes(q)
    );
  }

  private isActive(tool: RegisteredTool): boolean {
    if (tool.tier === "core" || !tool.tier) return true;
    const cat = (tool.category ?? "").toUpperCase();
    return this.activatedCategories.has(cat);
  }
}

export const registry = new ToolRegistry();
