/**
 * Splits text into at most `maxLines` lines that fit `maxWidth`, by word. Whatever still won't fit
 * ends in an ellipsis, as a canvas would otherwise squash it until it can't be read.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (line: string) => number,
  maxLines = 2,
): string[] {
  const lines: string[] = [];
  let current = '';
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? '';
    const next = current ? `${current} ${word}` : word;
    if (measure(next) <= maxWidth || !current) {
      current = next;
      continue;
    }
    if (lines.length === maxLines - 1) {
      current = `${current} ${words.slice(i).join(' ')}`;
      break;
    }
    lines.push(current);
    current = word;
  }
  if (measure(current) <= maxWidth) return current ? [...lines, current] : lines;

  let cut = current;
  while (cut.length > 1 && measure(`${cut}…`) > maxWidth) cut = cut.slice(0, -1);
  return [...lines, `${cut.trimEnd()}…`];
}
