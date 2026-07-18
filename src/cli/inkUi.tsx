import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useApp } from "ink";
import TextInput from "ink-text-input";

type Questioner = {
  question: (prompt: string) => Promise<string>;
  isTui: true;
};

type StoreSnapshot = {
  transcript: string[];
  status: string;
  statusline: string;
  tools: string[];
  promptLabel: string;
  input: string;
  modal: null | { prompt: string; buffer: string };
  header: string;
  subtitle: string;
};

class InkStore {
  private listeners = new Set<() => void>();
  private snapshot: StoreSnapshot;
  private resolveLine: null | ((line: string) => void) = null;
  private resolveQuestion: null | ((answer: string) => void) = null;

  constructor(header: string, subtitle: string) {
    this.snapshot = {
      transcript: [],
      status: "",
      statusline: "",
      tools: [],
      promptLabel: "you> ",
      input: "",
      modal: null,
      header,
      subtitle,
    };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get(): StoreSnapshot {
    return this.snapshot;
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  println(text: string): void {
    const next = [...this.snapshot.transcript];
    for (const l of String(text ?? "").split(/\r?\n/)) next.push(l);
    this.snapshot = { ...this.snapshot, transcript: next };
    this.emit();
  }

  setStatus(status: string): void {
    this.snapshot = { ...this.snapshot, status };
    this.emit();
  }

  setStatusline(statusline: string): void {
    this.snapshot = { ...this.snapshot, statusline };
    this.emit();
  }

  setTools(lines: string[]): void {
    this.snapshot = { ...this.snapshot, tools: lines.slice(-8) };
    this.emit();
  }

  setPromptLabel(label: string): void {
    this.snapshot = { ...this.snapshot, promptLabel: label };
    this.emit();
  }

  setInput(value: string): void {
    this.snapshot = { ...this.snapshot, input: value };
    this.emit();
  }

  submitInput(): void {
    const line = this.snapshot.input.trim();
    this.snapshot = { ...this.snapshot, input: "" };
    this.emit();
    if (this.resolveLine) {
      const r = this.resolveLine;
      this.resolveLine = null;
      r(line);
    }
  }

  async readLine(promptLabel: string): Promise<string> {
    this.setPromptLabel(promptLabel);
    this.setStatus("enter to send • /help • ctrl+c to exit");
    return new Promise<string>((resolve) => {
      this.resolveLine = resolve;
    });
  }

  createQuestioner(): Questioner {
    return {
      isTui: true,
      question: (prompt: string) =>
        new Promise<string>((resolve) => {
          this.resolveQuestion = resolve;
          this.snapshot = { ...this.snapshot, modal: { prompt, buffer: "" } };
          this.emit();
        }),
    };
  }

  setModalBuffer(v: string): void {
    if (!this.snapshot.modal) return;
    this.snapshot = { ...this.snapshot, modal: { ...this.snapshot.modal, buffer: v } };
    this.emit();
  }

  submitModal(): void {
    const answer = (this.snapshot.modal?.buffer ?? "").trim();
    this.snapshot = { ...this.snapshot, modal: null };
    this.emit();
    if (this.resolveQuestion) {
      const r = this.resolveQuestion;
      this.resolveQuestion = null;
      r(answer);
    }
  }

  cancelModal(): void {
    this.snapshot = { ...this.snapshot, modal: null };
    this.emit();
    if (this.resolveQuestion) {
      const r = this.resolveQuestion;
      this.resolveQuestion = null;
      r("");
    }
  }
}

export type InkUi = {
  start: () => void;
  stop: () => void;
  println: (text: string) => void;
  setStatus: (text: string) => void;
  setStatusline: (text: string) => void;
  setTools: (lines: string[]) => void;
  readLine: (promptLabel?: string) => Promise<string | null>;
  createQuestioner: () => Questioner;
};

export function createInkUi(opts: { title: string; subtitle: string }): InkUi {
  const store = new InkStore(opts.title, opts.subtitle);
  let unmount: null | (() => void) = null;

  return {
    start: () => {
      const instance = render(<InkRoot store={store} />, { exitOnCtrlC: true });
      unmount = () => instance.unmount();
    },
    stop: () => {
      if (unmount) unmount();
      unmount = null;
    },
    println: (t: string) => store.println(t),
    setStatus: (t: string) => store.setStatus(t),
    setStatusline: (t: string) => store.setStatusline(t),
    setTools: (t: string[]) => store.setTools(t),
    readLine: async (promptLabel = "you> ") => {
      try {
        return await store.readLine(promptLabel);
      } catch {
        return null;
      }
    },
    createQuestioner: () => store.createQuestioner(),
  };
}

function InkRoot({ store }: { store: InkStore }): React.JSX.Element {
  const { exit } = useApp();
  const [snap, setSnap] = useState<StoreSnapshot>(store.get());

  useEffect(() => store.subscribe(() => setSnap(store.get())), [store]);

  const view = useMemo(() => {
    const maxLines = Math.max(5, (process.stdout.rows ?? 24) - 9);
    return snap.transcript.slice(Math.max(0, snap.transcript.length - maxLines));
  }, [snap.transcript]);

  return (
    <Box flexDirection="column" height={process.stdout.rows ?? undefined}>
      <Box flexDirection="row">
        <Text color="magenta" bold>
          {snap.header}
        </Text>
        <Text color="gray"> {"--"} </Text>
        <Text color="cyan">{snap.subtitle}</Text>
      </Box>
      <Box>
        <Text color="gray">{snap.statusline}</Text>
      </Box>
      <Box flexDirection="row" flexGrow={1}>
        <Box
          borderStyle="round"
          borderColor="gray"
          flexDirection="column"
          flexGrow={1}
          paddingX={1}
          marginRight={1}
        >
          {view.map((l, i) => (
            <Text key={i}>{l}</Text>
          ))}
        </Box>
        <Box borderStyle="round" borderColor="gray" flexDirection="column" width={40} paddingX={1}>
          <Text color="gray">tools</Text>
          {snap.tools.length === 0 ? (
            <Text color="gray">(none)</Text>
          ) : (
            snap.tools.map((l, i) => <Text key={i}>{l}</Text>)
          )}
        </Box>
      </Box>

      <Box flexDirection="row">
        <Text bold>{snap.promptLabel}</Text>
        <TextInput
          value={snap.input}
          onChange={(v) => store.setInput(v)}
          onSubmit={() => store.submitInput()}
        />
      </Box>
      <Box>
        <Text color="gray">{snap.status}</Text>
      </Box>

      {snap.modal ? (
        <Box
          position="absolute"
          top={3}
          left={2}
          width={(process.stdout.columns ?? 80) - 4}
          borderStyle="double"
          borderColor="yellow"
          flexDirection="column"
          paddingX={1}
        >
          <Text color="yellow" bold>
            permission
          </Text>
          {snap.modal.prompt.split(/\r?\n/).map((l, i) => (
            <Text key={i}>{l}</Text>
          ))}
          <Box flexDirection="row">
            <Text bold>Approve? </Text>
            <TextInput
              value={snap.modal.buffer}
              onChange={(v) => store.setModalBuffer(v)}
              onSubmit={() => store.submitModal()}
            />
          </Box>
          <Text color="gray">enter to confirm • esc to cancel</Text>
          <InkModalKeys onCancel={() => store.cancelModal()} onExit={() => exit()} />
        </Box>
      ) : (
        <InkKeys onExit={() => exit()} />
      )}
    </Box>
  );
}

function InkKeys({ onExit }: { onExit: () => void }): null {
  // Ink handles ctrl+c via render({exitOnCtrlC:true}) but keep explicit exit hook.
  useEffect(() => {
    const handler = () => onExit();
    process.on("SIGINT", handler);
    return () => {
      process.off("SIGINT", handler);
    };
  }, [onExit]);
  return null;
}

function InkModalKeys({ onCancel, onExit }: { onCancel: () => void; onExit: () => void }): null {
  useEffect(() => {
    const handler = () => onExit();
    process.on("SIGINT", handler);
    return () => {
      process.off("SIGINT", handler);
    };
  }, [onExit]);
  useEffect(() => {
    const stdin = process.stdin;
    const onData = (buf: Buffer) => {
      // ESC
      if (buf.length === 1 && buf[0] === 0x1b) onCancel();
    };
    stdin.on("data", onData);
    return () => {
      stdin.off("data", onData);
    };
  }, [onCancel]);
  return null;
}
