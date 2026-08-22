import React from 'react';
import { Text, Box } from 'ink';

function ansi256ToHex(code: number): string {
  if (code < 16) {
    const basic = [
      "#000000", "#cd0000", "#00cd00", "#cdcd00", "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5",
      "#7f7f7f", "#ff0000", "#00ff00", "#ffff00", "#5c5cff", "#ff00ff", "#00ffff", "#ffffff"
    ];
    return basic[code];
  }
  if (code >= 232) {
    const v = 8 + (code - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  const n = code - 16;
  const b = (n % 6) ? (n % 6) * 40 + 55 : 0;
  const g = (Math.floor(n / 6) % 6) ? (Math.floor(n / 6) % 6) * 40 + 55 : 0;
  const r = (Math.floor(n / 36)) ? (Math.floor(n / 36)) * 40 + 55 : 0;
  return `rgb(${r},${g},${b})`;
}

/**
 * Parses raw ANSI-colored text (including 256-color escapes) into Ink <Text> elements.
 */
export const AnsiLog: React.FC<{ raw: string }> = ({ raw }) => {
  const parts: React.JSX.Element[] = [];
  const regex = /\u001b\[([0-9;]*)m/g;
  let match;
  let lastIndex = 0;

  let color: any = undefined;
  let bgColor: any = undefined;
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
          backgroundColor={bgColor}
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
    let i = 0;
    while (i < codes.length) {
      const code = codes[i];
      if (code === 0) {
        color = undefined;
        bgColor = undefined;
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
      } else if (code === 38 && codes[i + 1] === 5 && codes[i + 2] !== undefined) {
        color = ansi256ToHex(codes[i + 2]);
        i += 2;
      } else if (code === 48 && codes[i + 1] === 5 && codes[i + 2] !== undefined) {
        bgColor = ansi256ToHex(codes[i + 2]);
        i += 2;
      } else if (code >= 30 && code <= 37) {
        const colors = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
        color = colors[code - 30];
      } else if (code >= 40 && code <= 47) {
        const bgColors = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
        bgColor = bgColors[code - 40];
      } else if (code >= 90 && code <= 97) {
        const colors = ["gray", "redBright", "greenBright", "yellowBright", "blueBright", "magentaBright", "cyanBright", "whiteBright"];
        color = colors[code - 90];
      } else if (code >= 100 && code <= 107) {
        const bgColors = ["blackBright", "redBright", "greenBright", "yellowBright", "blueBright", "magentaBright", "cyanBright", "whiteBright"];
        bgColor = bgColors[code - 100];
      } else if (code === 39) {
        color = undefined;
      } else if (code === 49) {
        bgColor = undefined;
      }
      i++;
    }
    lastIndex = regex.lastIndex;
  }

  const remainingText = raw.substring(lastIndex);
  if (remainingText.length > 0 || parts.length === 0) {
    parts.push(
      <Text
        key={keyCount++}
        color={dim && !color ? "gray" : color}
        backgroundColor={bgColor}
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
