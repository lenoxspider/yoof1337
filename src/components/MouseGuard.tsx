import React, { useEffect, useRef } from 'react';
import { stdout } from 'process';

export const MouseGuard: React.FC<{
  children: React.ReactNode;
  onScrollUp: () => void;
  onScrollDown: () => void;
  disabled?: boolean;
}> = ({ children, onScrollUp, onScrollDown, disabled = false }) => {
  const handlersRef = useRef({ onScrollUp, onScrollDown, disabled });
  useEffect(() => {
    handlersRef.current = { onScrollUp, onScrollDown, disabled };
  }, [onScrollUp, onScrollDown, disabled]);

  useEffect(() => {
    const stdin = process.stdin;
    stdout.write('\x1b[?1000h\x1b[?1006h');

    const originalEmit = stdin.emit;
    (stdin as any).emit = function (event: string, ...args: any[]) {
      if (event === "data") {
        const buf = args[0];
        if (Buffer.isBuffer(buf)) {
          const str = buf.toString("utf8");
          const sgrRegex = /\u001b\[<(\d+);(\d+);(\d+)([Mm])/g;
          let match;
          let hasSgr = false;
          while ((match = sgrRegex.exec(str)) !== null) {
            hasSgr = true;
            if (!handlersRef.current.disabled) {
              const button = parseInt(match[1], 10);
              if (button === 64) {
                handlersRef.current.onScrollUp();
              } else if (button === 65) {
                handlersRef.current.onScrollDown();
              }
            }
          }

          if (hasSgr) {
            const cleanedStr = str.replace(/\u001b\[<\d+;\d+;\d+[Mm]/g, "");
            if (cleanedStr.length === 0) {
              return false;
            }
            args[0] = Buffer.from(cleanedStr, "utf8");
          }
        }
      }
      return (originalEmit as any).apply(this, [event, ...args]);
    };

    const cleanup = () => {
      stdout.write('\x1b[?1000l\x1b[?1006l');
      stdin.emit = originalEmit;
    };

    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    return () => {
      cleanup();
      process.off('exit', cleanup);
      process.off("SIGINT", cleanup);
      process.off("SIGTERM", cleanup);
    };
  }, []);

  return <>{children}</>;
};
