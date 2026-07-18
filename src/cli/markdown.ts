import { marked } from "marked";
import hljs from "highlight.js";
import chalk from "chalk";

/**
 * Render markdown to plain terminal-friendly text (no ANSI).
 * Keeps code fences readable and wraps a few common constructs.
 */
export function renderMarkdownToPlain(md: string): string {
  const text = String(md ?? "");
  if (!text.trim()) return "";

  // Preserve fenced code blocks as-is (marked strips some formatting in text render).
  const fences: string[] = [];
  const placeholder = (i: number) => `@@__FENCE_${i}__@@`;
  const withPlaceholders = text.replace(/```[\s\S]*?```/g, (m) => {
    const i = fences.push(m) - 1;
    return placeholder(i);
  });

  const rendered = marked.parse(withPlaceholders) as string;
  const stripped = stripHtml(rendered)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();

  return stripped.replace(/@@__FENCE_(\d+)__@@/g, (_m, n) => {
    const fence = fences[Number(n)] ?? "";
    // Turn ```lang\ncode\n``` into indented code for readability.
    const firstLine = fence.split(/\r?\n/, 1)[0] ?? "```";
    const lang = firstLine.replace(/^```/, "").trim();
    const body = fence.replace(/^```[^\n]*\n?/, "").replace(/```$/, "");
    const lines = body.replace(/\r?\n$/, "").split(/\r?\n/);
    const highlighted = highlight(lines.join("\n"), lang);
    return ["", ...highlighted.split(/\r?\n/).map((l) => `  ${l}`), ""].join("\n");
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<pre><code[^>]*>/g, "\n")
    .replace(/<\/code><\/pre>/g, "\n")
    .replace(/<\/p>\s*/g, "\n\n")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function highlight(code: string, lang: string): string {
  try {
    const res = lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang }) : hljs.highlightAuto(code);
    return colorizeFromHtml(res.value);
  } catch {
    return code;
  }
}

function colorizeFromHtml(html: string): string {
  // highlight.js returns HTML spans; map a few classes to chalk.
  // Keep this intentionally simple and readable.
  const unescaped = html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");

  const stack: Array<(s: string) => string> = [chalk.reset];
  let out = "";
  let i = 0;
  while (i < unescaped.length) {
    const nextTag = unescaped.indexOf("<", i);
    if (nextTag === -1) {
      out += stack[stack.length - 1](unescaped.slice(i));
      break;
    }
    out += stack[stack.length - 1](unescaped.slice(i, nextTag));
    const end = unescaped.indexOf(">", nextTag);
    if (end === -1) break;
    const tag = unescaped.slice(nextTag + 1, end);
    if (tag.startsWith("/span")) {
      if (stack.length > 1) stack.pop();
    } else {
      const m = tag.match(/class="([^"]+)"/);
      const cls = m?.[1] ?? "";
      stack.push(styleForClass(cls));
    }
    i = end + 1;
  }
  return out;
}

function styleForClass(cls: string): (s: string) => string {
  const c = cls.split(/\s+/g);
  if (c.includes("hljs-keyword")) return chalk.magentaBright;
  if (c.includes("hljs-title") || c.includes("hljs-function") || c.includes("hljs-built_in")) return chalk.cyanBright;
  if (c.includes("hljs-string") || c.includes("hljs-template-string")) return chalk.greenBright;
  if (c.includes("hljs-number") || c.includes("hljs-literal")) return chalk.yellowBright;
  if (c.includes("hljs-comment")) return chalk.gray;
  if (c.includes("hljs-attr") || c.includes("hljs-attribute") || c.includes("hljs-property")) return chalk.blueBright;
  if (c.includes("hljs-type") || c.includes("hljs-class")) return chalk.cyan;
  return chalk.reset;
}
