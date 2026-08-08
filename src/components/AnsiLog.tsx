import React from 'react';
import { Text, Box } from 'ink';

export const AnsiLog: React.FC<{ raw: string }> = ({ raw }) => {
  const parts: React.JSX.Element[] = [];
  const regex = /\u001b\[([0-9;]*)m/g;
  let match;
  let lastIndex = 0;
  
  let color: any = undefined;
  let bold = false;
  let dim = false;
  let italic = false;
  let underline = false;
  let inverse = false;
  let keyCount = 0;

  while ((match = regex.exec(raw)) !== null) {
    const textPart = raw.substring(lastIndex, match.index);
    if (textPart.length > 0) {
      parts.push(
        <Text
          key={keyCount++}
          color={dim && !color ? "gray" : color}
          bold={bold}
          italic={italic}
          underline={underline}
          inverse={inverse}
        >
          {textPart}
        </Text>
      );
    }
    
    const codes = match[1].split(";").map(Number);
    for (const code of codes) {
      if (code === 0) {
        color = undefined;
        bold = false;
        dim = false;
        italic = false;
        underline = false;
        inverse = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 2) {
        dim = true;
      } else if (code === 3) {
        italic = true;
      } else if (code === 4) {
        underline = true;
      } else if (code === 7) {
        inverse = true;
      } else if (code >= 30 && code <= 37) {
        const colors = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
        color = colors[code - 30];
      } else if (code >= 90 && code <= 97) {
        const colors = ["gray", "redBright", "greenBright", "yellowBright", "blueBright", "magentaBright", "cyanBright", "whiteBright"];
        color = colors[code - 90];
      } else if (code === 39) {
        color = undefined;
      }
    }
    lastIndex = regex.lastIndex;
  }

  const remainingText = raw.substring(lastIndex);
  if (remainingText.length > 0 || parts.length === 0) {
    parts.push(
      <Text
        key={keyCount++}
        color={dim && !color ? "gray" : color}
        bold={bold}
        italic={italic}
        underline={underline}
        inverse={inverse}
      >
        {remainingText}
      </Text>
    );
  }

  return <Box flexDirection="row">{parts}</Box>;
};
