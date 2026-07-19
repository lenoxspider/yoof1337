import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import TextInput from "ink-text-input";

const SLASH_COMMANDS = [
  { cmd: "/compact", desc: "summarize and shrink history" },
  { cmd: "/state", desc: "show tracked world state" },
  { cmd: "/sessions", desc: "list saved sessions" },
  { cmd: "/resume", desc: "resume a saved session" },
  { cmd: "/save", desc: "save current session" },
  { cmd: "/undo", desc: "git rollback" },
  { cmd: "/status", desc: "git status" },
  { cmd: "/diff", desc: "git diff" },
  { cmd: "/gh auth", desc: "show gh auth status" },
  { cmd: "/pr view", desc: "view PR" },
  { cmd: "/pr diff", desc: "diff PR" },
  { cmd: "/pr create", desc: "create PR" },
  { cmd: "/pr comment", desc: "comment PR" },
  { cmd: "/help", desc: "show help" },
  { cmd: "/exit", desc: "quit" },
];

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
  history: string[];
  historyIndex: number;
  autocompleteItems: { cmd: string; desc: string }[];
  autocompleteIndex: number;
  lastFoldedOutput: string | null;
  fullOutputModal: boolean;
  fullTranscriptModal: boolean;
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
      history: [],
      historyIndex: -1,
      autocompleteItems: [],
      autocompleteIndex: -1,
      lastFoldedOutput: null,
      fullOutputModal: false,
      fullTranscriptModal: false,
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

  setLastFoldedOutput(output: string | null): void {
    this.snapshot = { ...this.snapshot, lastFoldedOutput: output };
    this.emit();
  }

  toggleFullOutputModal(): void {
    if (this.snapshot.lastFoldedOutput) {
      this.snapshot = { ...this.snapshot, fullOutputModal: !this.snapshot.fullOutputModal };
      this.emit();
    }
  }

  toggleFullTranscriptModal(): void {
    this.snapshot = { ...this.snapshot, fullTranscriptModal: !this.snapshot.fullTranscriptModal };
    this.emit();
  }

  setPromptLabel(label: string): void {
    this.snapshot = { ...this.snapshot, promptLabel: label };
    this.emit();
  }

  setInput(value: string): void {
    if (value.includes("\t")) {
      this.commitAutocomplete();
      return;
    }

    // Support multi-line paste: if the terminal paste includes newlines, treat it as
    // an immediate submit of the full pasted text (minus trailing newlines).
    if (this.resolveLine && /[\r\n]/.test(value)) {
      const normalized = value.replace(/\r\n/g, "\n");
      const text = normalized.replace(/\n+$/g, "");
      this.snapshot = { ...this.snapshot, input: "", autocompleteItems: [], autocompleteIndex: -1 };
      this.emit();
      const r = this.resolveLine;
      this.resolveLine = null;
      r(text);
      return;
    }

    let autocompleteItems: {cmd:string, desc:string}[] = [];
    if (value.startsWith("/")) {
      const lower = value.toLowerCase();
      autocompleteItems = SLASH_COMMANDS.filter(c => c.cmd.startsWith(lower));
    }

    this.snapshot = { 
      ...this.snapshot, 
      input: value,
      autocompleteItems,
      autocompleteIndex: autocompleteItems.length > 0 ? 0 : -1
    };
    this.emit();
  }

  commitAutocomplete(): void {
    if (this.snapshot.autocompleteItems.length > 0 && this.snapshot.autocompleteIndex >= 0) {
      const selected = this.snapshot.autocompleteItems[this.snapshot.autocompleteIndex];
      if (selected) {
        this.snapshot = { ...this.snapshot, input: selected.cmd + " ", autocompleteItems: [], autocompleteIndex: -1 };
        this.emit();
      }
    }
  }

  navigateAutocomplete(direction: "up" | "down"): void {
    const { autocompleteItems, autocompleteIndex } = this.snapshot;
    if (autocompleteItems.length === 0) return;

    let nextIndex = autocompleteIndex;
    if (direction === "up") {
      nextIndex = autocompleteIndex > 0 ? autocompleteIndex - 1 : autocompleteItems.length - 1;
    } else {
      nextIndex = autocompleteIndex < autocompleteItems.length - 1 ? autocompleteIndex + 1 : 0;
    }

    this.snapshot = { ...this.snapshot, autocompleteIndex: nextIndex };
    this.emit();
  }

  submitInput(): void {
    if (this.snapshot.autocompleteItems.length > 0 && this.snapshot.autocompleteIndex >= 0) {
      const selected = this.snapshot.autocompleteItems[this.snapshot.autocompleteIndex];
      if (selected) {
        const line = selected.cmd;
        const newHistory = line ? [...this.snapshot.history, line] : this.snapshot.history;
        this.snapshot = { ...this.snapshot, input: "", history: newHistory, historyIndex: -1, autocompleteItems: [], autocompleteIndex: -1 };
        this.emit();
        if (this.resolveLine) {
          const r = this.resolveLine;
          this.resolveLine = null;
          r(line);
        } else if (line) {
          this.lineQueue.push(line);
        }
        return;
      }
    }

    const line = this.snapshot.input.trim();
    const newHistory = line ? [...this.snapshot.history, line] : this.snapshot.history;
    this.snapshot = {
      ...this.snapshot,
      input: "",
      history: newHistory,
      historyIndex: -1,
      autocompleteItems: [],
      autocompleteIndex: -1,
    };
    this.emit();
    if (this.resolveLine) {
      const r = this.resolveLine;
      this.resolveLine = null;
      r(line);
    } else if (line) {
      this.lineQueue.push(line);
    }
  }

  navigateHistory(direction: "up" | "down"): void {
    const { history, historyIndex, input } = this.snapshot;
    if (history.length === 0) return;

    let nextIndex = historyIndex;
    if (direction === "up") {
      if (historyIndex === -1) {
        nextIndex = history.length - 1;
      } else if (historyIndex > 0) {
        nextIndex = historyIndex - 1;
      }
    } else if (direction === "down") {
      if (historyIndex !== -1 && historyIndex < history.length - 1) {
        nextIndex = historyIndex + 1;
      } else if (historyIndex === history.length - 1) {
        nextIndex = -1; // back to empty input
      }
    }

    if (nextIndex === historyIndex) return;

    this.snapshot = {
      ...this.snapshot,
      historyIndex: nextIndex,
      input: nextIndex === -1 ? "" : history[nextIndex],
    };
    this.emit();
  }

  private lineQueue: string[] = [];

  async readLine(promptLabel: string): Promise<string> {
    this.setPromptLabel(promptLabel);
    this.setStatus("enter to send • /help • ctrl+c to exit");
    if (this.lineQueue.length > 0) {
      return Promise.resolve(this.lineQueue.shift()!);
    }
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
    // For permission prompts, keep only the first line if a multi-line paste occurs.
    const firstLine = v.split(/\r?\n/, 1)[0] ?? "";
    this.snapshot = { ...this.snapshot, modal: { ...this.snapshot.modal, buffer: firstLine } };
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
  setLastFoldedOutput?: (output: string | null) => void;
  readLine: (promptLabel?: string) => Promise<string | null>;
  createQuestioner: () => Questioner;
  onSigInt: (handler: () => void) => void;
};

export function createInkUi(opts: { title: string; subtitle: string }): InkUi {
  const store = new InkStore(opts.title, opts.subtitle);
  let unmount: null | (() => void) = null;
  let sigintHandler: (() => void) | null = null;

  return {
    start: () => {
      const instance = render(<InkRoot store={store} onExit={() => {
        if (sigintHandler) sigintHandler();
        else {
          instance.unmount();
          process.exit(0);
        }
      }} />, { exitOnCtrlC: false });
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
    setLastFoldedOutput: (t: string | null) => store.setLastFoldedOutput(t),
    readLine: async (promptLabel = "you> ") => {
      try {
        return await store.readLine(promptLabel);
      } catch {
        return null;
      }
    },
    createQuestioner: () => store.createQuestioner(),
    onSigInt: (handler: () => void) => {
      sigintHandler = handler;
    },
  };
}

function InkRoot({ store, onExit }: { store: InkStore; onExit: () => void }): React.JSX.Element {
  const [snap, setSnap] = useState<StoreSnapshot>(store.get());

  useEffect(() => store.subscribe(() => setSnap(store.get())), [store]);

  const view = useMemo(() => {
    const maxLines = Math.max(5, (process.stdout.rows ?? 24) - 9);
    return snap.transcript.slice(Math.max(0, snap.transcript.length - maxLines));
  }, [snap.transcript]);

  useInput((input, key) => {
    if (snap.modal) return; // let modal handle keys
    
    if (snap.autocompleteItems.length > 0) {
      if (key.upArrow) {
        store.navigateAutocomplete("up");
        return;
      } else if (key.downArrow) {
        store.navigateAutocomplete("down");
        return;
      } else if (key.rightArrow || key.tab) {
        store.commitAutocomplete();
        return;
      }
    }

    if (key.ctrl && input === "o") {
      store.toggleFullOutputModal();
      return;
    }

    if (key.ctrl && input === "t") {
      store.toggleFullTranscriptModal();
      return;
    }
    
    if (snap.fullOutputModal || snap.fullTranscriptModal) return;

    if (key.upArrow) {
      store.navigateHistory("up");
    } else if (key.downArrow) {
      store.navigateHistory("down");
    }
  });

  if (snap.fullOutputModal && snap.lastFoldedOutput) {
    return <FullOutputModal text={snap.lastFoldedOutput} onClose={() => store.toggleFullOutputModal()} />;
  }

  if (snap.fullTranscriptModal) {
    return <FullTranscriptModal transcript={snap.transcript} onClose={() => store.toggleFullTranscriptModal()} />;
  }

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
        <Text backgroundColor="blue" color="white"> {snap.statusline} </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Box
          borderStyle="round"
          borderColor="gray"
          flexDirection="column"
          flexGrow={1}
          paddingX={1}
        >
          {view.map((l, i) => (
            <Text key={i}>{l}</Text>
          ))}
        </Box>
        {(snap.modal || snap.tools.length > 0) && (
          <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1}>
            {snap.modal ? (
              <>
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
                    focus={!!snap.modal}
                  />
                </Box>
                <Text color="gray">enter to confirm • esc to cancel</Text>
                <InkModalKeys onCancel={() => store.cancelModal()} onExit={() => onExit()} />
              </>
            ) : (
              <>
                <Text color="gray">tools running</Text>
                {snap.tools.map((l, i) => <Text key={i}>{l}</Text>)}
              </>
            )}
          </Box>
        )}
      </Box>

      {snap.autocompleteItems.length > 0 && (
        <Box flexDirection="column" paddingX={1} borderStyle="single" borderColor="cyan" width="50%">
          {snap.autocompleteItems.map((item, i) => (
            <Text key={item.cmd} color={i === snap.autocompleteIndex ? "black" : "white"} backgroundColor={i === snap.autocompleteIndex ? "cyan" : undefined}>
              {item.cmd.padEnd(15)} <Text color={i === snap.autocompleteIndex ? "black" : "gray"}>{item.desc}</Text>
            </Text>
          ))}
        </Box>
      )}

      <Box flexDirection="row">
        <Text bold>{snap.promptLabel}</Text>
        <TextInput
          value={snap.input}
          onChange={(v) => store.setInput(v)}
          onSubmit={() => store.submitInput()}
          focus={!snap.modal}
        />
      </Box>
      <Box>
        <Text color="gray">{snap.status}</Text>
      </Box>
      {!snap.modal ? <InkKeys onExit={() => onExit()} /> : null}
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
  }, [onCancel, onExit]);
  return null;
}

function FullOutputModal({ text, onClose }: { text: string; onClose: () => void }) {
  const [offset, setOffset] = useState(0);
  const lines = text.split(/\r?\n/);
  const maxLines = (process.stdout.rows ?? 24) - 4; // leave room for header/footer

  useInput((input, key) => {
    if (key.upArrow) setOffset((o) => Math.max(0, o - 1));
    else if (key.downArrow) setOffset((o) => Math.min(Math.max(0, lines.length - maxLines), o + 1));
    else if (key.escape || (key.ctrl && input === "o")) onClose();
  });

  const visibleLines = lines.slice(offset, offset + maxLines);

  return (
    <Box flexDirection="column" height={process.stdout.rows ?? undefined} padding={1} borderStyle="double" borderColor="cyan">
      <Text color="cyan" bold>Expanded Output ({lines.length} lines)</Text>
      <Box flexGrow={1} flexDirection="column" marginTop={1}>
        {visibleLines.map((l, i) => (
          <Text key={i}>{l}</Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Use Up/Down to scroll • Esc or Ctrl+O to close</Text>
      </Box>
    </Box>
  );
}

function FullTranscriptModal({ transcript, onClose }: { transcript: string[]; onClose: () => void }) {
  const maxLines = (process.stdout.rows ?? 24) - 4; // leave room for header/footer
  const [offset, setOffset] = useState(() => Math.max(0, transcript.length - maxLines));

  useInput((input, key) => {
    if (key.upArrow) setOffset((o) => Math.max(0, o - 1));
    else if (key.downArrow) setOffset((o) => Math.min(Math.max(0, transcript.length - maxLines), o + 1));
    else if (key.escape || (key.ctrl && input === "t")) onClose();
  });

  const visibleLines = transcript.slice(offset, offset + maxLines);

  return (
    <Box flexDirection="column" height={process.stdout.rows ?? undefined} padding={1} borderStyle="double" borderColor="magenta">
      <Text color="magenta" bold>Full Transcript ({transcript.length} lines)</Text>
      <Box flexGrow={1} flexDirection="column" marginTop={1}>
        {visibleLines.map((l, i) => (
          <Text key={i}>{l}</Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Use Up/Down to scroll • Esc or Ctrl+T to close</Text>
      </Box>
    </Box>
  );
}
