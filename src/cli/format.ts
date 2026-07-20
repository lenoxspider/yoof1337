/** Small formatting helpers for turn telemetry (durations, token counts). */

/** Format a millisecond duration as "4m 52s", "12s", or "820ms". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

/** Compact a token count: 1234 -> "1.2k", 999 -> "999", 2_500_000 -> "2.5M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Running tallies for a single turn (mirrors TurnProgress from the agent loop). */
export interface TurnProgressLike {
  elapsedMs: number;
  llmCalls: number;
  toolCalls: number;
  promptTokens: number;
  completionTokens: number;
  hasUsage: boolean;
}

/**
 * Compact live detail for the busy line, e.g. "↓ 225 tokens" or "3 tools".
 * Prefers token counts when the server reports usage, else falls back to counts.
 */
export function progressDetail(p: TurnProgressLike): string {
  if (p.hasUsage && p.completionTokens > 0) {
    return `↓ ${formatTokens(p.completionTokens)} tokens`;
  }
  if (p.toolCalls > 0) return `${p.toolCalls} tool${p.toolCalls === 1 ? "" : "s"}`;
  return "";
}

/**
 * Closing one-line summary, e.g.
 * "Brewed for 4m 52s · 3 model calls · 5 tools · ↑ 1.2k ↓ 340 tokens".
 */
export function turnSummary(p: TurnProgressLike): string {
  const parts = [`Brewed for ${formatDuration(p.elapsedMs)}`];
  if (p.llmCalls > 0) parts.push(`${p.llmCalls} model call${p.llmCalls === 1 ? "" : "s"}`);
  if (p.toolCalls > 0) parts.push(`${p.toolCalls} tool${p.toolCalls === 1 ? "" : "s"}`);
  if (p.hasUsage && (p.promptTokens > 0 || p.completionTokens > 0)) {
    parts.push(`↑ ${formatTokens(p.promptTokens)} ↓ ${formatTokens(p.completionTokens)} tokens`);
  }
  return parts.join(" · ");
}
