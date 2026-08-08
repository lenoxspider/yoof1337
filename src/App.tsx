import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { BufferedInput } from './components/BufferedInput.js';
import { MouseGuard } from './components/MouseGuard.js';
import { OverlayModal } from './components/OverlayModal.js';
import { AnsiLog } from './components/AnsiLog.js';
import { KeyMap } from './keyboard/KeyMap.js';
import { useViewport } from './hooks/useViewport.js';

const keyMap = new KeyMap();

// Bind shortcuts (example)
keyMap.bind(
  { key: { name: 'upArrow' }, ctx: 'autocomplete', priority: 10 },
  () => console.log('autocomplete up')
);
keyMap.bind(
  { key: { name: 'upArrow' }, ctx: 'history', priority: 5 },
  () => console.log('history up')
);

export const App = () => {
  const [logs, setLogs] = useState<string[]>([]);
  const [modal, setModal] = useState<null | { title: string; onConfirm: (v: string) => void }>(null);
  const { viewportRows } = useViewport();

  const submit = (cmd: string) => {
    setLogs((l) => [...l, `> ${cmd}`]);
    setLogs((l) => [...l, `[agent] running ${cmd}`]);
  };

  useInput((input, key) => {
    const action = keyMap.resolve(key, modal ? 'modal' : 'history');
    if (action) action();
  });

  return (
    <MouseGuard
      onScrollUp={() => {}}
      onScrollDown={() => {}}
      disabled={!!modal}
    >
      <Box flexDirection="column">
        {/* Header */}
        <Text color="magentaBright" bold>
          yoof1337 -- terminal coding agent
        </Text>

        {/* Status Bar */}
        <Box>
          <Text color="white" backgroundColor="blue"> [ SYSTEM STATUS ] Ready for input • /help • Ctrl+C to exit </Text>
        </Box>

        {/* Transcript viewport */}
        <Box
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          height={viewportRows}
          flexDirection="column"
        >
          {logs.slice(-viewportRows).map((line, i) => (
            <AnsiLog key={i} raw={line} />
          ))}
        </Box>

        {/* Modal overlay */}
        {modal && (
          <OverlayModal title={modal.title} onClose={() => setModal(null)}>
            <BufferedInput
              value=""
              onChange={() => {}}
              onSubmit={() => {
                modal.onConfirm("");
                setModal(null);
              }}
            />
          </OverlayModal>
        )}

        {/* Input line */}
        <Box>
          <Text>you&gt; </Text>
          <BufferedInput
            value=""
            onChange={() => {}}
            onSubmit={() => submit("test")}
          />
        </Box>
      </Box>
    </MouseGuard>
  );
};
