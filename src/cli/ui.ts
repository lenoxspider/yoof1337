export const ansi = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  bold: "\u001b[1m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
  gray: "\u001b[90m",
};

export function color(text: string, ...codes: string[]): string {
  return `${codes.join("")}${text}${ansi.reset}`;
}

export function formatBox(title: string, lines: string[]): string {
  const content = [title, ...lines].filter((l) => l.length > 0);
  const width = Math.min(120, Math.max(...content.map((l) => stripAnsi(l).length), 0));
  const top = `+${"-".repeat(width + 2)}+`;
  const body = content
    .map((l) => {
      const plain = stripAnsi(l);
      const padding = " ".repeat(Math.max(0, width - plain.length));
      return `| ${l}${padding} |`;
    })
    .join("\n");
  return `${top}\n${body}\n${top}`;
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}

