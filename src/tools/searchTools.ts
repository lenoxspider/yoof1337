import { registry } from "./registry.js";
import type { SandboxContext } from "./sandbox.js";

export async function searchTools(
  input: { query: string },
  ctx: SandboxContext
): Promise<string> {
  const query = input.query || "";
  const results = registry.search(query);

  if (results.length === 0) {
    return `No tools found matching "${query}".`;
  }

  let output = `Found ${results.length} tools matching "${query}":\n\n`;
  for (const tool of results) {
    output += `- **${tool.definition.name}** [${tool.category || "UNCATEGORIZED"}]\n`;
    output += `  ${tool.definition.description}\n`;
  }

  return output;
}
