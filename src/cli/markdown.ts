import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

// Initialize marked-terminal
marked.use(markedTerminal() as any);

/**
 * Render markdown to rich terminal-friendly text with syntax highlighting.
 */
export function renderMarkdownToPlain(md: string): string {
  const text = String(md ?? "");
  if (!text.trim()) return "";
  
  try {
    return marked.parse(text) as string;
  } catch (err) {
    return text;
  }
}
