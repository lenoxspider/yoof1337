import readline from "node:readline";
import process from "node:process";
import { ansi, color, stripAnsi } from "./ui.js";

type Key = {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
};

export type TuiQuestioner = {
  question: (prompt: string) => Promise<string>;
  isTui: true;
};

export type TuiAppOptions = {
  title: string;
  subtitle?: string;
};

export class TuiApp {
  private transcript: string[] = [];
  private input = "";
  private status = "";
  private dirty = true;
  private closed = false;

  private modal:
    | null
    | {
        prompt: string;
        resolve: (value: string) => void;
        buffer: string;
      } = null;

  constructor(private readonly opts: TuiAppOptions) {}

  start(): void {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return;

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", this.onKeypress);

    process.stdout.write("\u001b[?25l"); // hide cursor
    this.renderLoop();
  }

  stop(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      process.stdin.off("keypress", this.onKeypress);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
    } catch {
      // ignore
    }
    process.stdout.write("\u001b[?25h"); // show cursor
    process.stdout.write("\u001b[0m\n");
  }

  println(line: string): void {
    for (const l of String(line ?? "").split(/\r?\n/)) this.transcript.push(l);
    this.dirty = true;
  }

  setStatus(text: string): void {
    this.status = text;
    this.dirty = true;
  }

  getInput(): string {
    return this.input;
  }

  clearInput(): void {
    this.input = "";
    this.dirty = true;
  }

  createQuestioner(): TuiQuestioner {
    return {
      isTui: true,
      question: (prompt: string) =>
        new Promise<string>((resolve) => {
          this.modal = { prompt, resolve, buffer: "" };
          this.dirty = true;
        }),
    };
  }

  async readLine(promptLabel = "you> "): Promise<string | null> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return null;
    this.setStatus(color("enter to send • /help • ctrl+c to exit", ansi.dim));
    this.dirty = true;
    return new Promise<string | null>((resolve) => {
      const poll = () => {
        if (this.closed) return resolve(null);
        // resolved by enter handler
        (this as any)._resolveLine = resolve;
        (this as any)._promptLabel = promptLabel;
        setTimeout(poll, 50);
      };
      poll();
    });
  }

  private renderLoop = (): void => {
    if (this.closed) return;
    if (this.dirty) this.render();
    setTimeout(this.renderLoop, 33);
  };

  private render(): void {
    this.dirty = false;
    const out = process.stdout;
    const width = out.columns ?? 80;
    const height = out.rows ?? 24;

    const header = `${color(this.opts.title, ansi.bold, ansi.magenta)} ${color("--", ansi.gray)} ${color(
      this.opts.subtitle ?? "",
      ansi.dim
    )}`.trimEnd();
    const divider = color("─".repeat(Math.max(0, width)), ansi.gray);

    const promptLabel = (this as any)._promptLabel ?? "you> ";
    const prompt = `${color(promptLabel, ansi.bold)}${this.input}`;
    const status = this.status ? this.status : "";

    const reserved = 1 /*header*/ + 1 /*divider*/ + 1 /*prompt*/ + 1 /*status*/ + (this.modal ? 4 : 0);
    const transcriptHeight = Math.max(0, height - reserved);
    const view = this.transcript.slice(Math.max(0, this.transcript.length - transcriptHeight));

    out.write("\u001b[2J\u001b[H"); // clear + home
    out.write(padToWidth(header, width) + "\n");
    out.write(divider + "\n");
    for (let i = 0; i < transcriptHeight; i++) {
      out.write(padToWidth(view[i] ?? "", width) + "\n");
    }
    out.write(padToWidth(prompt, width) + "\n");
    out.write(padToWidth(status, width) + "\n");

    if (this.modal) this.renderModal(width);
  }

  private renderModal(width: number): void {
    const out = process.stdout;
    const m = this.modal!;
    const title = color("permission", ansi.bold, ansi.yellow);
    const promptLines = `${m.prompt}${m.buffer}`.split(/\r?\n/);
    const lines = [
      `${title} ${color("(type y/yes to approve)", ansi.dim)}`,
      ...promptLines,
      color("enter to confirm • esc to cancel", ansi.dim),
    ];
    const boxWidth = Math.min(width, Math.max(...lines.map((l) => stripAnsi(l).length)) + 4);
    const top = color(`┌${"─".repeat(boxWidth - 2)}┐`, ansi.gray);
    const bottom = color(`└${"─".repeat(boxWidth - 2)}┘`, ansi.gray);
    const body = lines
      .map((l) => {
        const pad = " ".repeat(Math.max(0, boxWidth - 4 - stripAnsi(l).length));
        return color("│", ansi.gray) + " " + l + pad + " " + color("│", ansi.gray);
      })
      .join("\n");

    out.write(top + "\n");
    out.write(body + "\n");
    out.write(bottom + "\n");
  }

  private onKeypress = (str: string, key: Key): void => {
    if (key.ctrl && (key.name === "c" || key.sequence === "\u0003")) {
      this.stop();
      return;
    }

    if (this.modal) {
      this.handleModalKey(str, key);
      return;
    }

    if (key.name === "return") {
      const line = this.input.trim();
      this.println(`${color("you", ansi.gray)} ${color(">", ansi.gray)} ${line}`);
      this.input = "";
      this.dirty = true;
      const resolve = (this as any)._resolveLine as undefined | ((v: string) => void);
      if (resolve) {
        (this as any)._resolveLine = undefined;
        resolve(line);
      }
      return;
    }

    if (key.name === "backspace") {
      this.input = this.input.slice(0, -1);
      this.dirty = true;
      return;
    }

    if (key.name === "escape") {
      this.input = "";
      this.dirty = true;
      return;
    }

    if (!key.ctrl && !key.meta && str) {
      this.input += str;
      this.dirty = true;
    }
  };

  private handleModalKey(str: string, key: Key): void {
    const m = this.modal!;
    if (key.name === "escape") {
      this.modal = null;
      m.resolve("");
      this.dirty = true;
      return;
    }
    if (key.name === "return") {
      const v = m.buffer.trim();
      this.modal = null;
      m.resolve(v);
      this.dirty = true;
      return;
    }
    if (key.name === "backspace") {
      m.buffer = m.buffer.slice(0, -1);
      this.dirty = true;
      return;
    }
    if (!key.ctrl && !key.meta && str) {
      m.buffer += str;
      this.dirty = true;
    }
  }
}

function padToWidth(s: string, width: number): string {
  const plainLen = stripAnsi(s).length;
  if (plainLen >= width) return s.slice(0, width);
  return s + " ".repeat(width - plainLen);
}
