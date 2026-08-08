import { useWindowSize } from 'ink';
import { useMemo } from 'react';

export const useViewport = (extraRows: number = 9) => {
  const { columns, rows } = useWindowSize();
  const viewportRows = useMemo(() => {
    return Math.max(5, (rows ?? 24) - extraRows);
  }, [rows, extraRows]);
  return { columns, rows, viewportRows };
};
