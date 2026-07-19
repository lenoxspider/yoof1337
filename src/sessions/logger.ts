import fs from "node:fs/promises";
import path from "node:path";
import type { SessionMeta } from "./store.js";
import type { WorldState } from "../loop/state.js";

export type LogEvent =
  | ({ type: "meta" } & SessionMeta)
  | { type: "user"; content: string; originalTask?: string }
  | { type: "assistant"; content: string; toolCalls?: any[] }
  | { type: "tool"; toolCallId: string; content: string }
  | { type: "progress"; world: WorldState }
  | { type: "system"; subtype: "compact_boundary"; summary?: string };

export class SessionLogger {
  private queue: Promise<void> = Promise.resolve();
  public readonly filepath: string;

  constructor(dir: string, sessionId: string) {
    this.filepath = path.join(dir, `${sessionId}.jsonl`);
  }

  /**
   * Block and await the write (e.g. for user messages).
   */
  async logSync(event: LogEvent): Promise<void> {
    const line = JSON.stringify(event) + "\n";
    this.queue = this.queue.then(() => fs.appendFile(this.filepath, line, "utf8")).catch((err) => {
      console.error(`Failed to log to session: ${err}`);
    });
    await this.queue;
  }

  /**
   * Fire-and-forget logging. Preserves order by chaining promises.
   */
  logAsync(event: LogEvent): void {
    const line = JSON.stringify(event) + "\n";
    this.queue = this.queue.then(() => fs.appendFile(this.filepath, line, "utf8")).catch((err) => {
      console.error(`Failed to log to session: ${err}`);
    });
  }

  async flush(): Promise<void> {
    await this.queue;
  }
}
