import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useInput } from "ink";

import { useViewport } from "../hooks/useViewport.js";
import { AnsiLog } from "../components/AnsiLog.js";
import { OverlayModal } from "../components/OverlayModal.js";

/* ──────────────────────────────────────────────────────────────────────────────
 * Theme — curated 256-color palette for a premium dark-terminal aesthetic
 * ────────────────────────────────────────────────────────────────────────── */

const THEME = {
  // Borders & structure
  border: "#585858",
  activeBorder: "#5fd7ff",

  // Header & branding
  header: "#af87ff",
  subtitle: "#5fd7ff",

  // Status indicators
  success: "#87d787",
  warning: "#ffaf5f",
  error: "#ff5f5f",

  // Text hierarchy
  text: "white",
  muted: "#6c6c6c",

  // Status bar
  statusBarBg: "#303030",
  statusBarFg: "#e4e4e4",

  // Sidebar
  sidebarHeader: "#afafaf",

  // Spinner & activity
  spinner: "#5fd7ff",
  activity: "#af87ff",

  // Autocomplete highlights
  highlightBg: "#5fd7ff",
  highlightFg: "#000000",

  // Scroll indicator
  scrollBg: "#ffaf5f",
  scrollFg: "#000000",
} as const;

/* ──────────────────────────────────────────────────────────────────────────────
 * Slash-command autocomplete list
 * ────────────────────────────────────────────────────────────────────────── */

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

/* ──────────────────────────────────────────────────────────────────────────────
 * Custom PromptInput Component
 * Built directly on top of Ink's useInput to ensure robust control key handling,
 * cursor positioning, and immunity to terminal mouse escape sequences.
 * ────────────────────────────────────────────────────────────────────────── */

function PromptInput({
  value,
  onChange,
  onSubmit,
  focus = true,
  placeholder = "",
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  focus?: boolean;
  placeholder?: string;
}): React.JSX.Element {
  const [cursorOffset, setCursorOffset] = useState(value.length);

  useEffect(() => {
    setCursorOffset(value.length);
  }, [value]);

  useInput(
    (input, key) => {
      if (!focus) return;

      // Ignore mouse sequences (e.g. scroll wheel or clicks)
      if (
        input.startsWith("\x1b") ||
        input.startsWith("[<") ||
        input.startsWith("<") ||
        /^\x1b?\[?<\d+;\d+;\d+[Mm]/.test(input)
      ) {
        return;
      }

      // Handle Ctrl shortcuts for line editing
      if (key.ctrl) {
        if (input === "a" || input === "\x01") {
          // Ctrl+A: Go to start of line
          setCursorOffset(0);
          return;
        }
        if (input === "e" || input === "\x05") {
          // Ctrl+E: Go to end of line
          setCursorOffset(value.length);
          return;
        }
        if (input === "u" || input === "\x15") {
          // Ctrl+U: Clear line
          onChange("");
          setCursorOffset(0);
          return;
        }
        if (input === "k" || input === "\x0b") {
          // Ctrl+K: Kill to end of line
          onChange(value.slice(0, cursorOffset));
          return;
        }
        // Let other Ctrl keys pass through to parent
        return;
      }

      // Ignore navigation / scrolling keys so parent keyhandlers can process them
      if (
        key.pageUp ||
        key.pageDown ||
        key.upArrow ||
        key.downArrow ||
        key.tab ||
        (key.shift && key.tab)
      ) {
        return;
      }

      if (key.return) {
        onSubmit();
        return;
      }

      if (key.leftArrow) {
        setCursorOffset((prev) => Math.max(0, prev - 1));
        return;
      }

      if (key.rightArrow) {
        setCursorOffset((prev) => Math.min(value.length, prev + 1));
        return;
      }

      if (key.home) {
        setCursorOffset(0);
        return;
      }

      if (key.end) {
        setCursorOffset(value.length);
        return;
      }

      if (key.backspace) {
        if (cursorOffset > 0) {
          const next = value.slice(0, cursorOffset - 1) + value.slice(cursorOffset);
          setCursorOffset((prev) => Math.max(0, prev - 1));
          onChange(next);
        }
        return;
      }

      if (key.delete) {
        if (cursorOffset < value.length) {
          const next = value.slice(0, cursorOffset) + value.slice(cursorOffset + 1);
          onChange(next);
        }
        return;
      }

      // Regular character typing or pasted text
      const next = value.slice(0, cursorOffset) + input + value.slice(cursorOffset);
      setCursorOffset((prev) => prev + input.length);
      onChange(next);
    },
    { isActive: focus }
  );

  const safeOffset = Math.min(value.length, Math.max(0, cursorOffset));
  const before = value.slice(0, safeOffset);
  const cursorChar = safeOffset < value.length ? value[safeOffset] : " ";
  const after = safeOffset < value.length ? value.slice(safeOffset + 1) : "";

  if (value.length === 0 && placeholder && !focus) {
    return <Text color="gray">{placeholder}</Text>;
  }

  return (
    <Text>
      {before}
      {focus ? <Text inverse>{cursorChar}</Text> : cursorChar}
      {after}
    </Text>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Types
 * ────────────────────────────────────────────────────────────────────────── */

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
  busy: null | { activity: string; startedAt: number; detail?: string };
  pastePreview: string[] | null;
  sidebarVisible: boolean;
};

/* ──────────────────────────────────────────────────────────────────────────────
 * InkStore — reactive state container shared between the REPL loop and the
 * React/Ink render tree.
 * ────────────────────────────────────────────────────────────────────────── */

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
      busy: null,
      pastePreview: null,
      sidebarVisible: true,
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

  /* ── Output ────────────────────────────────────────────────────────────── */

  println(text: string): void {
    const next = [...this.snapshot.transcript];
    for (const l of String(text ?? "").split(/\r?\n/)) next.push(l);
    this.snapshot = { ...this.snapshot, transcript: next };
    this.emit();
  }

  /* ── Status / busy / tools ─────────────────────────────────────────────── */

  setStatus(status: string): void {
    this.snapshot = { ...this.snapshot, status };
    this.emit();
  }

  setBusy(busy: null | { activity: string; startedAt: number; detail?: string }): void {
    this.snapshot = { ...this.snapshot, busy };
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

  toggleSidebar(): void {
    this.snapshot = { ...this.snapshot, sidebarVisible: !this.snapshot.sidebarVisible };
    this.emit();
  }

  /* ── Input handling ────────────────────────────────────────────────────── */

  setPromptLabel(label: string): void {
    this.snapshot = { ...this.snapshot, promptLabel: label };
    this.emit();
  }

  setInput(value: string): void {
    // Detect paste (multiple lines appear at once)
    if (this.resolveLine && /[\r\n]/.test(value)) {
      const lines = value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        this.snapshot = { ...this.snapshot, pastePreview: lines, input: "" };
        this.emit();
        return;
      }
    }

    let autocompleteItems: { cmd: string; desc: string }[] = [];
    if (value.startsWith("/")) {
      const lower = value.toLowerCase();
      autocompleteItems = SLASH_COMMANDS.filter((c) => c.cmd.startsWith(lower));
    }

    this.snapshot = {
      ...this.snapshot,
      input: value,
      autocompleteItems,
      autocompleteIndex: autocompleteItems.length > 0 ? 0 : -1,
    };
    this.emit();
  }

  commitAutocomplete(): void {
    if (this.snapshot.autocompleteItems.length > 0 && this.snapshot.autocompleteIndex >= 0) {
      const selected = this.snapshot.autocompleteItems[this.snapshot.autocompleteIndex];
      if (selected) {
        this.snapshot = {
          ...this.snapshot,
          input: selected.cmd + " ",
          autocompleteItems: [],
          autocompleteIndex: -1,
        };
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
    // If autocomplete is active and an item is selected, submit that item
    if (this.snapshot.autocompleteItems.length > 0 && this.snapshot.autocompleteIndex >= 0) {
      const selected = this.snapshot.autocompleteItems[this.snapshot.autocompleteIndex];
      if (selected) {
        const line = selected.cmd;
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

  /* ── Paste handling ────────────────────────────────────────────────────── */

  confirmPasteLine(index: number): void {
    const lines = this.snapshot.pastePreview;
    if (!lines) return;
    const cmd = lines[index] ?? "";
    this.snapshot = { ...this.snapshot, pastePreview: null, input: "" };
    this.emit();
    if (cmd) {
      if (this.resolveLine) {
        const r = this.resolveLine;
        this.resolveLine = null;
        r(cmd);
      } else {
        this.lineQueue.push(cmd);
      }
    }
  }

  cancelPastePreview(): void {
    this.snapshot = { ...this.snapshot, pastePreview: null, input: "" };
    this.emit();
  }

  /* ── History navigation ────────────────────────────────────────────────── */

  navigateHistory(direction: "up" | "down"): void {
    const { history, historyIndex } = this.snapshot;
    if (history.length === 0) return;

    let nextIndex = historyIndex;
    if (direction === "up") {
      if (historyIndex === -1) nextIndex = history.length - 1;
      else if (historyIndex > 0) nextIndex = historyIndex - 1;
    } else if (direction === "down") {
      if (historyIndex !== -1 && historyIndex < history.length - 1) nextIndex = historyIndex + 1;
      else if (historyIndex === history.length - 1) nextIndex = -1;
    }

    if (nextIndex === historyIndex) return;

    this.snapshot = {
      ...this.snapshot,
      historyIndex: nextIndex,
      input: nextIndex === -1 ? "" : history[nextIndex],
    };
    this.emit();
  }

  /* ── Line queue / readline ─────────────────────────────────────────────── */

  private lineQueue: string[] = [];

  async readLine(promptLabel: string): Promise<string> {
    this.setPromptLabel(promptLabel);
    this.setStatus("Enter to send • /help • Ctrl+C to exit");
    if (this.lineQueue.length > 0) {
      return Promise.resolve(this.lineQueue.shift()!);
    }
    return new Promise<string>((resolve) => {
      this.resolveLine = resolve;
    });
  }

  /* ── Permission modal ──────────────────────────────────────────────────── */

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

/* ──────────────────────────────────────────────────────────────────────────────
 * Public API
 * ────────────────────────────────────────────────────────────────────────── */

export type InkUi = {
  start: () => void;
  stop: () => void;
  println: (text: string) => void;
  setStatus: (text: string) => void;
  setBusy: (busy: null | { activity: string; startedAt: number; detail?: string }) => void;
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
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
      }
      // Enable SGR mouse tracking mode (scroll wheel support)
      process.stdout.write("\x1b[?1000h\x1b[?1006h");

      const instance = render(
        <InkRoot
          store={store}
          onExit={() => {
            process.stdout.write("\x1b[?1000l\x1b[?1006l");
            if (sigintHandler) sigintHandler();
            else {
              instance.unmount();
              if (process.stdin.isTTY) process.stdin.setRawMode(false);
              process.exit(0);
            }
          }}
        />,
        { exitOnCtrlC: false }
      );
      unmount = () => {
        process.stdout.write("\x1b[?1000l\x1b[?1006l");
        instance.unmount();
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
      };
    },
    stop: () => {
      process.stdout.write("\x1b[?1000l\x1b[?1006l");
      if (unmount) unmount();
      unmount = null;
    },
    println: (t: string) => store.println(t),
    setStatus: (t: string) => store.setStatus(t),
    setBusy: (b) => store.setBusy(b),
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

/* ──────────────────────────────────────────────────────────────────────────────
 * InkRoot — the main dashboard component
 * ────────────────────────────────────────────────────────────────────────── */

function InkRoot({ store, onExit }: { store: InkStore; onExit: () => void }): React.JSX.Element {
  const [snap, setSnap] = useState<StoreSnapshot>(store.get());
  const [scrollOffset, setScrollOffset] = useState(0);
  const [prevLength, setPrevLength] = useState(snap.transcript.length);

  const { columns, rows, viewportRows, isWide, sidebarWidth } = useViewport(8);

  useEffect(() => store.subscribe(() => setSnap(store.get())), [store]);

  // Adjust scroll offset when transcript length changes
  useEffect(() => {
    if (snap.transcript.length !== prevLength) {
      const diff = snap.transcript.length - prevLength;
      setPrevLength(snap.transcript.length);
      setScrollOffset((o) => {
        const limit = Math.max(0, snap.transcript.length - viewportRows);
        if (diff < 0) return Math.min(limit, Math.max(0, o + diff));
        if (o > 0 && diff > 0) return Math.min(limit, o + diff);
        return Math.min(limit, o);
      });
    }
  }, [snap.transcript.length, prevLength, viewportRows]);

  // Compute visible transcript slice
  const view = useMemo(() => {
    const end = snap.transcript.length - scrollOffset;
    const start = Math.max(0, end - viewportRows);
    return snap.transcript.slice(start, end);
  }, [snap.transcript, scrollOffset, viewportRows]);

  const showSidebar = isWide && snap.sidebarVisible;

  // ── Global Input & Keybindings ──────────────────────────────────────────

  useInput((input, key) => {
    // If a modal or preview is open, let that modal handle keys
    if (snap.modal || snap.pastePreview) return;
    if (snap.fullOutputModal || snap.fullTranscriptModal) return;

    // Handle mouse wheel scrolling
    const mouseMatch = /^\x1b?\[?<(\d+);(\d+);(\d+)[Mm]/.exec(input);
    if (mouseMatch) {
      const button = parseInt(mouseMatch[1], 10);
      if (button === 64) {
        // Wheel Up: scroll up into history
        const limit = Math.max(0, snap.transcript.length - viewportRows);
        setScrollOffset((o) => Math.min(limit, o + 3));
        return;
      }
      if (button === 65) {
        // Wheel Down: scroll down towards bottom
        setScrollOffset((o) => Math.max(0, o - 3));
        return;
      }
      return;
    }

    // Ctrl+C to exit
    if (key.ctrl && (input === "c" || input === "\x03")) {
      onExit();
      return;
    }

    // Ctrl+B: Toggle Sidebar (when wide)
    if (key.ctrl && (input === "b" || input === "\x02")) {
      if (isWide) store.toggleSidebar();
      return;
    }

    // Ctrl+O: Toggle Full Output Modal
    if (key.ctrl && (input === "o" || input === "\x0f")) {
      store.toggleFullOutputModal();
      return;
    }

    // Ctrl+T: Toggle Full Transcript Modal
    if (key.ctrl && (input === "t" || input === "\x14")) {
      store.toggleFullTranscriptModal();
      return;
    }

    // Autocomplete Navigation
    if (snap.autocompleteItems.length > 0) {
      if (key.upArrow) {
        store.navigateAutocomplete("up");
        return;
      }
      if (key.downArrow) {
        store.navigateAutocomplete("down");
        return;
      }
      if (key.tab || key.rightArrow) {
        store.commitAutocomplete();
        return;
      }
      if (key.escape) {
        store.setInput("");
        return;
      }
    }

    // Viewport Scroll: PageUp, PageDown, Shift+Up/Down, Ctrl+Up/Down
    if (key.pageUp) {
      const limit = Math.max(0, snap.transcript.length - viewportRows);
      const amount = Math.max(1, Math.floor(viewportRows / 2));
      setScrollOffset((o) => Math.min(limit, o + amount));
      return;
    }
    if (key.pageDown) {
      const amount = Math.max(1, Math.floor(viewportRows / 2));
      setScrollOffset((o) => Math.max(0, o - amount));
      return;
    }
    if ((key.shift || key.ctrl) && key.upArrow) {
      const limit = Math.max(0, snap.transcript.length - viewportRows);
      setScrollOffset((o) => Math.min(limit, o + 1));
      return;
    }
    if ((key.shift || key.ctrl) && key.downArrow) {
      setScrollOffset((o) => Math.max(0, o - 1));
      return;
    }
    if (scrollOffset > 0 && (key.return || key.escape)) {
      setScrollOffset(0);
      return;
    }

    // History navigation (only when not scrolled and no autocomplete)
    if (scrollOffset === 0 && snap.autocompleteItems.length === 0) {
      if (key.upArrow) {
        store.navigateHistory("up");
        return;
      }
      if (key.downArrow) {
        store.navigateHistory("down");
        return;
      }
    }
  });

  // ── Full-screen modal overrides ─────────────────────────────────────────

  if (snap.fullOutputModal && snap.lastFoldedOutput) {
    return <FullOutputModal text={snap.lastFoldedOutput} onClose={() => store.toggleFullOutputModal()} />;
  }
  if (snap.fullTranscriptModal) {
    return <FullTranscriptModal transcript={snap.transcript} onClose={() => store.toggleFullTranscriptModal()} />;
  }

  // ── Hotkey legend ───────────────────────────────────────────────────────

  const legendText = getHotkeyLegend({
    modal: !!snap.modal,
    pastePreview: !!snap.pastePreview,
    scrolled: scrollOffset > 0,
    sidebarVisible: snap.sidebarVisible,
    isWide,
  });

  const statusBarText = ` ${snap.statusline || "ready"} `;

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <Box>
        <Text color={THEME.header} bold>  ◆ {snap.header}</Text>
        <Text color={THEME.border}> ── </Text>
        <Text color={THEME.subtitle}>{snap.subtitle}</Text>
      </Box>

      {/* ── Status Bar ─────────────────────────────────────────────── */}
      <Box>
        <Text backgroundColor={THEME.statusBarBg} color={THEME.statusBarFg}>
          {statusBarText}
        </Text>
      </Box>

      {/* ── Main Content: Split Pane ───────────────────────────────── */}
      <Box flexDirection="row" flexGrow={1}>
        {/* Transcript Panel */}
        <Box
          flexDirection="column"
          flexGrow={1}
          borderStyle="round"
          borderColor={scrollOffset > 0 ? THEME.activeBorder : THEME.border}
          paddingX={1}
        >
          {view.map((l, i) => (
            <Box key={i}><AnsiLog raw={l} /></Box>
          ))}
        </Box>

        {/* Sidebar */}
        {showSidebar && (
          <Box
            flexDirection="column"
            width={sidebarWidth}
            borderStyle="round"
            borderColor={THEME.border}
            paddingX={1}
          >
            {/* Status */}
            <Text color={THEME.sidebarHeader} bold>◼ STATUS</Text>
            {snap.busy ? (
              <Text color={THEME.activity} wrap="truncate-end">
                {"● "}{snap.busy.activity}
              </Text>
            ) : (
              <Text color={THEME.muted}>● Idle</Text>
            )}
            <Text>{" "}</Text>

            {/* Tools */}
            <Text color={THEME.sidebarHeader} bold>◼ TOOLS</Text>
            {snap.tools.length > 0 ? (
              snap.tools.slice(-6).map((l, i) => (
                <Text key={i} color={THEME.muted} wrap="truncate-end">{l}</Text>
              ))
            ) : (
              <Text color={THEME.muted}>  (none)</Text>
            )}
            <Text>{" "}</Text>

            {/* Info */}
            <Text color={THEME.sidebarHeader} bold>◼ INFO</Text>
            <Text color={THEME.muted} wrap="truncate-end">
              {snap.status || "Ready"}
            </Text>
          </Box>
        )}
      </Box>

      {/* ── Scroll Indicator ───────────────────────────────────────── */}
      {scrollOffset > 0 && (
        <Box paddingX={1}>
          <Text backgroundColor={THEME.scrollBg} color={THEME.scrollFg} bold>
            {" ▲ SCROLLED (" + scrollOffset + " lines) • Enter/Esc to return ▲ "}
          </Text>
        </Box>
      )}

      {/* ── Autocomplete Popup ─────────────────────────────────────── */}
      {snap.autocompleteItems.length > 0 && (
        <Box
          flexDirection="column"
          paddingX={1}
          borderStyle="single"
          borderColor={THEME.activeBorder}
          width="50%"
        >
          {snap.autocompleteItems.map((item, i) => (
            <Text
              key={item.cmd}
              color={i === snap.autocompleteIndex ? THEME.highlightFg : undefined}
              backgroundColor={i === snap.autocompleteIndex ? THEME.highlightBg : undefined}
              wrap="truncate-end"
            >
              {item.cmd.padEnd(15)}{" "}
              <Text color={i === snap.autocompleteIndex ? THEME.highlightFg : THEME.muted}>
                {item.desc}
              </Text>
            </Text>
          ))}
        </Box>
      )}

      {/* ── Input Line ─────────────────────────────────────────────── */}
      <Box>
        <Text bold color={THEME.activeBorder}>{snap.promptLabel}</Text>
        <PromptInput
          value={snap.input}
          onChange={(v) => store.setInput(v)}
          onSubmit={() => store.submitInput()}
          focus={!snap.modal && !snap.pastePreview}
        />
      </Box>

      {/* ── Busy / Status ──────────────────────────────────────────── */}
      <Box>
        {snap.busy ? (
          <BusyLine busy={snap.busy} />
        ) : (
          <Text color={THEME.muted}>{snap.status}</Text>
        )}
      </Box>

      {/* ── Hotkey Legend ───────────────────────────────────────────── */}
      <Box>
        <Text color={THEME.muted}>{legendText}</Text>
      </Box>

      <InkKeys onExit={() => onExit()} />

      {/* ── Permission Modal (overlay) ─────────────────────────────── */}
      {snap.modal && (
        <OverlayModal
          title="⚠️  PERMISSION REQUESTED"
          borderColor={THEME.warning}
          width={Math.min(columns - 4, 70)}
        >
          <Box marginY={1} flexDirection="column">
            {snap.modal.prompt.split(/\r?\n/).map((l, i) => (
              <Text key={i}>{l}</Text>
            ))}
          </Box>
          <Box flexDirection="row" marginTop={1}>
            <Text bold>Approve? [y/N]: </Text>
            <PromptInput
              value={snap.modal.buffer}
              onChange={(v) => store.setModalBuffer(v)}
              onSubmit={() => store.submitModal()}
              focus={true}
            />
          </Box>
          <Box marginTop={1}>
            <Text color={THEME.muted}>Enter to confirm • Esc to cancel</Text>
          </Box>
          <InkModalKeys onCancel={() => store.cancelModal()} onExit={() => onExit()} />
        </OverlayModal>
      )}

      {/* ── Paste Review Modal (overlay) ───────────────────────────── */}
      {snap.pastePreview && (
        <OverlayModal
          title="📋  Paste detected – review each line:"
          borderColor={THEME.activeBorder}
          width={Math.min(columns - 4, 70)}
        >
          <Box flexDirection="column" marginY={1}>
            {snap.pastePreview.map((line, i) => (
              <Box key={i} marginLeft={2}>
                <Text color={THEME.warning}>{i + 1}. </Text>
                <Text>{line}</Text>
              </Box>
            ))}
          </Box>
          <Box flexDirection="row" marginTop={1}>
            <Text bold>Enter line number to send: </Text>
            <PromptInput
              value={snap.input}
              onChange={(v) => store.setInput(v)}
              onSubmit={() => {
                const idx = parseInt(snap.input, 10) - 1;
                store.confirmPasteLine(idx);
              }}
              focus={true}
              placeholder="Enter line number"
            />
          </Box>
          <Box marginTop={1}>
            <Text color={THEME.muted}>Esc to cancel</Text>
          </Box>
          <InkModalKeys onCancel={() => store.cancelPastePreview()} onExit={() => onExit()} />
        </OverlayModal>
      )}
    </Box>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Sub-components
 * ────────────────────────────────────────────────────────────────────────── */

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Animated braille spinner + activity label + elapsed timer. */
function BusyLine({ busy }: { busy: { activity: string; startedAt: number; detail?: string } }): React.JSX.Element {
  const [frame, setFrame] = useState(0);
  const [, setTick] = useState(0);

  useEffect(() => {
    const spin = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 100);
    const clock = setInterval(() => setTick((t) => t + 1), 250);
    return () => {
      clearInterval(spin);
      clearInterval(clock);
    };
  }, []);

  const elapsed = Date.now() - busy.startedAt;
  const secs = Math.floor(elapsed / 1000);
  const timeStr = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;

  return (
    <Text color={THEME.spinner}>
      {SPINNER_FRAMES[frame]} <Text color={THEME.activity}>{busy.activity}</Text>
      <Text color={THEME.muted}>
        {" "}({timeStr}
        {busy.detail ? ` · ${busy.detail}` : ""})
      </Text>
    </Text>
  );
}

/** Context-aware hotkey legend for the footer. */
function getHotkeyLegend(state: {
  modal: boolean;
  pastePreview: boolean;
  scrolled: boolean;
  sidebarVisible: boolean;
  isWide: boolean;
}): string {
  if (state.modal) return "Enter Confirm │ Esc Cancel";
  if (state.pastePreview) return "# Send Line │ Esc Cancel";

  const items: string[] = [];
  if (state.isWide) {
    items.push(state.sidebarVisible ? "^B Hide Panel" : "^B Show Panel");
  }
  items.push("^O Expand", "^T Transcript");
  if (state.scrolled) {
    items.push("Enter/Esc Return");
  }
  items.push("PgUp/Dn Scroll", "Tab Complete", "/help", "^C Exit");
  return items.join(" │ ");
}

/** Listens for SIGINT and calls onExit. */
function InkKeys({ onExit }: { onExit: () => void }): null {
  useEffect(() => {
    const handler = () => onExit();
    process.on("SIGINT", handler);
    return () => {
      process.off("SIGINT", handler);
    };
  }, [onExit]);
  return null;
}

/** Listens for Esc (cancel) and SIGINT (exit) inside modals. */
function InkModalKeys({ onCancel, onExit }: { onCancel: () => void; onExit: () => void }): null {
  useEffect(() => {
    const handler = () => onExit();
    process.on("SIGINT", handler);
    return () => {
      process.off("SIGINT", handler);
    };
  }, [onExit]);
  useInput((input, key) => {
    if (key.escape) onCancel();
    if (key.ctrl && (input === "c" || input === "\x03")) onExit();
  });
  return null;
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Full-screen modal views
 * ────────────────────────────────────────────────────────────────────────── */

function FullOutputModal({ text, onClose }: { text: string; onClose: () => void }) {
  const [offset, setOffset] = useState(0);
  const lines = text.split(/\r?\n/);
  const maxLines = (process.stdout.rows ?? 24) - 4;

  useInput((input, key) => {
    const mouseMatch = /^\x1b?\[?<(\d+);(\d+);(\d+)[Mm]/.exec(input);
    if (mouseMatch) {
      const button = parseInt(mouseMatch[1], 10);
      if (button === 64) setOffset((o) => Math.max(0, o - 3));
      if (button === 65) setOffset((o) => Math.min(Math.max(0, lines.length - maxLines), o + 3));
      return;
    }

    if (key.upArrow) setOffset((o) => Math.max(0, o - 1));
    else if (key.downArrow) setOffset((o) => Math.min(Math.max(0, lines.length - maxLines), o + 1));
    else if (key.pageUp) setOffset((o) => Math.max(0, o - Math.floor(maxLines / 2)));
    else if (key.pageDown) setOffset((o) => Math.min(Math.max(0, lines.length - maxLines), o + Math.floor(maxLines / 2)));
    else if (key.escape || (key.ctrl && (input === "o" || input === "\x0f"))) onClose();
  });

  const visibleLines = lines.slice(offset, offset + maxLines);

  return (
    <Box
      flexDirection="column"
      height={process.stdout.rows ?? undefined}
      padding={1}
      borderStyle="double"
      borderColor={THEME.activeBorder}
    >
      <Text color={THEME.activeBorder} bold>
        Expanded Output ({lines.length} lines)
      </Text>
      <Box flexGrow={1} flexDirection="column" marginTop={1}>
        {visibleLines.map((l, i) => (
          <Text key={i}>{l}</Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={THEME.muted}>Up/Down / PgUp/PgDn / Mouse Wheel to scroll • Esc or ^O to close</Text>
      </Box>
    </Box>
  );
}

function FullTranscriptModal({ transcript, onClose }: { transcript: string[]; onClose: () => void }) {
  const maxLines = (process.stdout.rows ?? 24) - 4;
  const [offset, setOffset] = useState(() => Math.max(0, transcript.length - maxLines));

  useInput((input, key) => {
    const mouseMatch = /^\x1b?\[?<(\d+);(\d+);(\d+)[Mm]/.exec(input);
    if (mouseMatch) {
      const button = parseInt(mouseMatch[1], 10);
      if (button === 64) setOffset((o) => Math.max(0, o - 3));
      if (button === 65) setOffset((o) => Math.min(Math.max(0, transcript.length - maxLines), o + 3));
      return;
    }

    if (key.upArrow) setOffset((o) => Math.max(0, o - 1));
    else if (key.downArrow) setOffset((o) => Math.min(Math.max(0, transcript.length - maxLines), o + 1));
    else if (key.pageUp) setOffset((o) => Math.max(0, o - Math.floor(maxLines / 2)));
    else if (key.pageDown) setOffset((o) => Math.min(Math.max(0, transcript.length - maxLines), o + Math.floor(maxLines / 2)));
    else if (key.escape || (key.ctrl && (input === "t" || input === "\x14"))) onClose();
  });

  const visibleLines = transcript.slice(offset, offset + maxLines);

  return (
    <Box
      flexDirection="column"
      height={process.stdout.rows ?? undefined}
      padding={1}
      borderStyle="double"
      borderColor={THEME.header}
    >
      <Text color={THEME.header} bold>
        Full Transcript ({transcript.length} lines)
      </Text>
      <Box flexGrow={1} flexDirection="column" marginTop={1}>
        {visibleLines.map((l, i) => (
          <Text key={i}>{l}</Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={THEME.muted}>Up/Down / PgUp/PgDn / Mouse Wheel to scroll • Esc or ^T to close</Text>
      </Box>
    </Box>
  );
}
