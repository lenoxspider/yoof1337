import fs from "node:fs/promises";
import path from "node:path";
import { execaCommand } from "execa";
import { registry, type RegisteredTool } from "./registry.js";
import type { SandboxContext } from "./sandbox.js";

export interface CustomToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  commandTemplate: string;
  mutating?: boolean;
  category?: string;
}

const CUSTOM_TOOLS_REL_PATH = ".yoof1337/custom-tools.json";

function getCustomToolsPath(root: string): string {
  return path.join(root, CUSTOM_TOOLS_REL_PATH);
}

async function readCustomToolsFile(root: string): Promise<Record<string, CustomToolSpec>> {
  const filePath = getCustomToolsPath(root);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeCustomToolsFile(root: string, tools: Record<string, CustomToolSpec>): Promise<void> {
  const filePath = getCustomToolsPath(root);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(tools, null, 2), "utf-8");
}

/**
 * Substitute {{var}} in commandTemplate with input values.
 */
function interpolateCommand(template: string, input: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_, key) => {
    const val = input[key];
    if (val === undefined || val === null) return "";
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  });
}

function registerCustomTool(spec: CustomToolSpec): void {
  const tool: RegisteredTool = {
    category: spec.category ?? "CUSTOM TOOLS",
    mutating: spec.mutating ?? true,
    tier: "core",
    definition: {
      name: spec.name,
      description: spec.description,
      inputSchema: spec.inputSchema ?? { type: "object", properties: {} },
    },
    execute: async (input: Record<string, unknown>, ctx: SandboxContext): Promise<string> => {
      const command = interpolateCommand(spec.commandTemplate, input);
      try {
        const res = await execaCommand(command, {
          cwd: ctx.root,
          windowsHide: true,
          shell: true,
          timeout: 60_000,
        });
        const out = (res.stdout || "").trim();
        const err = (res.stderr || "").trim();
        if (err && out) return `STDOUT:\n${out}\n\nSTDERR:\n${err}`;
        return out || err || "(command executed successfully with no output)";
      } catch (err: any) {
        return `Execution error: ${err.message}${err.stdout ? `\nSTDOUT: ${err.stdout}` : ""}${err.stderr ? `\nSTDERR: ${err.stderr}` : ""}`;
      }
    },
  };
  registry.register(tool);
}

/**
 * Load and register all stored custom tools from the workspace.
 */
export async function loadCustomTools(root: string): Promise<number> {
  const stored = await readCustomToolsFile(root);
  let count = 0;
  for (const spec of Object.values(stored)) {
    registerCustomTool(spec);
    count++;
  }
  return count;
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Dynamic Meta-Tools
 * ────────────────────────────────────────────────────────────────────────── */

export async function createTool(
  input: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    commandTemplate: string;
    mutating?: boolean;
    category?: string;
  },
  ctx: SandboxContext
): Promise<string> {
  const name = String(input.name ?? "").trim();
  if (!name) return "Error: Tool name is required.";
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return `Error: Tool name "${name}" is invalid. Use letters, numbers, underscores, and dashes only.`;
  }
  if (!input.commandTemplate) {
    return "Error: commandTemplate is required (e.g. 'npx eslint {{path}}' or 'npm test -- {{test}}').";
  }

  const spec: CustomToolSpec = {
    name,
    description: input.description ?? `Custom tool: ${name}`,
    inputSchema: input.inputSchema ?? { type: "object", properties: {} },
    commandTemplate: input.commandTemplate,
    mutating: input.mutating ?? true,
    category: input.category ?? "CUSTOM TOOLS",
  };

  registerCustomTool(spec);

  const stored = await readCustomToolsFile(ctx.root);
  stored[name] = spec;
  await writeCustomToolsFile(ctx.root, stored);

  return `✓ Tool "${name}" created and registered successfully. It is now active and ready to be called.`;
}

export async function updateTool(
  input: {
    name: string;
    updates: Partial<Omit<CustomToolSpec, "name">>;
  },
  ctx: SandboxContext
): Promise<string> {
  const name = String(input.name ?? "").trim();
  const stored = await readCustomToolsFile(ctx.root);
  const existing = stored[name];

  if (!existing) {
    return `Error: Custom tool "${name}" not found. (Built-in tools cannot be modified with update_tool).`;
  }

  const updated: CustomToolSpec = {
    ...existing,
    ...(input.updates ?? {}),
    name,
  };

  registerCustomTool(updated);
  stored[name] = updated;
  await writeCustomToolsFile(ctx.root, stored);

  return `✓ Tool "${name}" updated successfully.`;
}

export async function listTools(
  _input: Record<string, unknown>,
  _ctx: SandboxContext
): Promise<string> {
  const tools = registry.getAll().map((t) => ({
    name: t.definition.name,
    category: t.category ?? "CORE",
    mutating: t.mutating,
    description: t.definition.description,
    input_schema: t.definition.inputSchema,
  }));
  return JSON.stringify({ count: tools.length, tools }, null, 2);
}

export async function deleteTool(
  input: { name: string },
  ctx: SandboxContext
): Promise<string> {
  const name = String(input.name ?? "").trim();
  const stored = await readCustomToolsFile(ctx.root);

  if (!stored[name]) {
    return `Error: Custom tool "${name}" not found in custom tools registry.`;
  }

  delete stored[name];
  await writeCustomToolsFile(ctx.root, stored);
  registry.unregister(name);

  return `✓ Custom tool "${name}" deleted and unregistered.`;
}
