export function hintForToolResult(toolName: string, result: string): string | null {
  if (toolName !== "run_command" && toolName !== "run_command_bg" && toolName !== "check_command") return null;

  const text = String(result ?? "");
  const lower = text.toLowerCase();

  if (lower.includes("python was not found") || lower.includes("could not find python")) {
    return `Hint: Windows may be using the Microsoft Store python alias. Try running: "py --version" or disable the alias in Settings > Apps > App execution aliases.`;
  }
  if (lower.includes("not recognized as an internal or external command")) {
    return `Hint: Command not found. Verify it's installed and on PATH.`;
  }
  if (lower.includes("fatal: not a git repository")) {
    return `Hint: You're not in a git repo. Try: "git init" or run in the project root.`;
  }
  if (lower.includes("unable to connect to the remote server") || lower.includes("could not resolve host") || lower.includes("fetch failed")) {
    return `Hint: Network/DNS issue. Verify the URL from the same machine with curl, and check firewall/port mapping.`;
  }
  if (lower.includes("killed: timeout")) {
    return `Hint: Command timed out. Consider increasing commandTimeoutMs or running it in the background (run_command_bg) and polling (check_command).`;
  }
  return null;
}

