/* ──────────────────────────────────────────────────────────────────────────────
 * Fast Terminal Syntax Highlighter (Pure TS, 256-color ANSI)
 * ────────────────────────────────────────────────────────────────────────── */

const COLORS = {
  keyword: "\x1b[38;5;141m", // Purple
  type: "\x1b[38;5;81m",     // Cyan
  string: "\x1b[38;5;114m",   // Green
  number: "\x1b[38;5;215m",   // Orange/Yellow
  boolean: "\x1b[38;5;215m",  // Orange/Yellow
  comment: "\x1b[38;5;242m",  // Dim Gray
  diffAdd: "\x1b[38;5;114m",  // Bright Green
  diffDel: "\x1b[38;5;203m",  // Red
  diffHunk: "\x1b[38;5;81m",  // Cyan
  diffHeader: "\x1b[38;5;220m", // Yellow
  reset: "\x1b[0m",
};

const JS_KEYWORDS = new Set([
  "abstract", "any", "as", "async", "await", "boolean", "break", "case", "catch",
  "class", "const", "continue", "debugger", "declare", "default", "delete", "do",
  "else", "enum", "export", "extends", "false", "finally", "for", "from", "function",
  "get", "if", "implements", "import", "in", "instanceof", "interface", "is",
  "keyof", "let", "module", "namespace", "never", "new", "null", "number", "object",
  "of", "package", "private", "protected", "public", "readonly", "require", "return",
  "set", "static", "string", "super", "switch", "symbol", "this", "throw", "true",
  "try", "type", "typeof", "undefined", "unknown", "var", "void", "while", "with", "yield"
]);

const PY_KEYWORDS = new Set([
  "and", "as", "assert", "async", "await", "break", "class", "continue", "def",
  "del", "elif", "else", "except", "False", "finally", "for", "from", "global",
  "if", "import", "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass",
  "raise", "return", "True", "try", "while", "with", "yield"
]);

/**
 * Highlights a code block based on language.
 */
export function highlightCode(code: string, lang = ""): string {
  const normalizedLang = (lang || "").toLowerCase().trim();

  if (normalizedLang === "diff" || normalizedLang === "patch") {
    return highlightDiff(code);
  }

  const lines = code.split("\n");
  const isPy = normalizedLang === "py" || normalizedLang === "python";
  const keywords = isPy ? PY_KEYWORDS : JS_KEYWORDS;

  return lines.map((line) => highlightLine(line, keywords, isPy)).join("\n");
}

function highlightLine(line: string, keywords: Set<string>, isPy: boolean): string {
  // Check for whole-line comment
  const trimmed = line.trimStart();
  if ((!isPy && (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*"))) ||
      (isPy && trimmed.startsWith("#"))) {
    return `${COLORS.comment}${line}${COLORS.reset}`;
  }

  let out = "";
  let i = 0;
  const len = line.length;

  while (i < len) {
    const ch = line[i];

    // Trailing inline comment
    if (!isPy && ch === "/" && line[i + 1] === "/") {
      out += `${COLORS.comment}${line.slice(i)}${COLORS.reset}`;
      break;
    }
    if (isPy && ch === "#") {
      out += `${COLORS.comment}${line.slice(i)}${COLORS.reset}`;
      break;
    }

    // String literals (single, double, template backtick)
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let str = quote;
      i++;
      while (i < len && line[i] !== quote) {
        if (line[i] === "\\" && i + 1 < len) {
          str += line[i] + line[i + 1];
          i += 2;
        } else {
          str += line[i];
          i++;
        }
      }
      if (i < len) {
        str += line[i];
        i++;
      }
      out += `${COLORS.string}${str}${COLORS.reset}`;
      continue;
    }

    // Number literals
    if (/[0-9]/.test(ch) && (i === 0 || /[^a-zA-Z0-9_$]/.test(line[i - 1]))) {
      let num = "";
      while (i < len && /[0-9.xXa-fA-F_]/.test(line[i])) {
        num += line[i];
        i++;
      }
      out += `${COLORS.number}${num}${COLORS.reset}`;
      continue;
    }

    // Word tokens (keywords, identifiers)
    if (/[a-zA-Z_$]/.test(ch)) {
      let word = "";
      while (i < len && /[a-zA-Z0-9_$]/.test(line[i])) {
        word += line[i];
        i++;
      }

      if (keywords.has(word)) {
        if (word === "true" || word === "false" || word === "True" || word === "False" || word === "null" || word === "None" || word === "undefined") {
          out += `${COLORS.boolean}${word}${COLORS.reset}`;
        } else if (word === "string" || word === "number" || word === "boolean" || word === "any" || word === "void" || word === "Promise") {
          out += `${COLORS.type}${word}${COLORS.reset}`;
        } else {
          out += `${COLORS.keyword}${word}${COLORS.reset}`;
        }
      } else {
        out += word;
      }
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/**
 * Highlights unified diffs / patches.
 */
export function highlightDiff(diff: string): string {
  const lines = diff.split("\n");
  return lines
    .map((line) => {
      if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff --git") || line.startsWith("index ")) {
        return `${COLORS.diffHeader}${line}${COLORS.reset}`;
      }
      if (line.startsWith("@@")) {
        return `${COLORS.diffHunk}${line}${COLORS.reset}`;
      }
      if (line.startsWith("+")) {
        return `${COLORS.diffAdd}${line}${COLORS.reset}`;
      }
      if (line.startsWith("-")) {
        return `${COLORS.diffDel}${line}${COLORS.reset}`;
      }
      return line;
    })
    .join("\n");
}
