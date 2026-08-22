import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { highlightCode } from "./syntaxHighlight.js";

// Initialize marked-terminal with custom syntax highlighter
marked.use(
  (markedTerminal as any)({
    highlight: (code: string, lang?: string) => highlightCode(code, lang ?? ""),
  })
);

/**
 * Render markdown to rich terminal-friendly text with syntax highlighting.
 */
export function renderMarkdownToPlain(md: string): string {
  const text = String(md ?? "");
  if (!text.trim()) return "";

  try {
    return marked.parse(text) as string;
  } catch {
    return text;
  }
}
