import { useWindowSize } from 'ink';
import { useMemo } from 'react';

const MIN_WIDE_COLS = 80;
const MAX_SIDEBAR_WIDTH = 40;
const SIDEBAR_RATIO = 0.3;

export const useViewport = (reservedRows: number = 8) => {
  const { columns, rows } = useWindowSize();

  return useMemo(() => {
    const totalRows = rows ?? 24;
    const totalCols = columns ?? 80;
    const isWide = totalCols >= MIN_WIDE_COLS;
    const sidebarWidth = isWide
      ? Math.min(MAX_SIDEBAR_WIDTH, Math.floor(totalCols * SIDEBAR_RATIO))
      : 0;
    const viewportRows = Math.max(5, totalRows - reservedRows);

    return {
      columns: totalCols,
      rows: totalRows,
      viewportRows,
      isWide,
      sidebarWidth,
    };
  }, [columns, rows, reservedRows]);
};
