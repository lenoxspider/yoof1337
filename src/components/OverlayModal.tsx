import React from 'react';
import { Box, Text } from 'ink';

/**
 * Centered overlay modal with solid opaque background and double-border.
 * Uses absolute positioning to float over the main dashboard without text bleed-through.
 */
export const OverlayModal: React.FC<{
  title: string;
  borderColor?: string;
  width?: number;
  height?: number;
  onClose?: () => void;
  children: React.ReactNode;
}> = ({ title, borderColor = "#ffaf5f", width = 76, height, onClose, children }) => {
  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <Box
        flexDirection="column"
        borderStyle="double"
        borderColor={borderColor}
        backgroundColor="#161616"
        paddingX={2}
        paddingY={1}
        width={width}
        height={height}
      >
        <Box marginBottom={1}>
          <Text color={borderColor} bold>{title}</Text>
        </Box>
        {children}
        {onClose && (
          <Box marginTop={1}>
            <Text color="#6c6c6c">(Esc to cancel)</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
