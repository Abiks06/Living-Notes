const MAX_LINES = 3;

/** The split whose widest line is narrowest, so a title reads as an even block. */
function balanced(
  words: readonly string[],
  lines: number,
  widthOf: (text: string) => number,
): { lines: string[]; widest: number } {
  if (lines === 1) {
    const line = words.join(' ');
    return { lines: [line], widest: widthOf(line) };
  }
  let best: { lines: string[]; widest: number } | null = null;
  for (let split = 1; split <= words.length - lines + 1; split++) {
    const head = words.slice(0, split).join(' ');
    const rest = balanced(words.slice(split), lines - 1, widthOf);
    const widest = Math.max(widthOf(head), rest.widest);
    if (!best || widest < best.widest) best = { lines: [head, ...rest.lines], widest };
  }
  return best ?? { lines: [words.join(' ')], widest: 0 };
}

/**
 * Breaks a word or title into lines. One line shrinks to fit, so it stays that way until the
 * letters would get too small to read as particles.
 *
 * @param comfortable The widest a single line can be, at full size, and still read well.
 */
export function wordLines(
  word: string,
  widthOf: (text: string) => number,
  comfortable: number,
): string[] {
  const words = word.split(' ').filter(Boolean);
  const count = Math.min(MAX_LINES, words.length, Math.ceil(widthOf(word) / comfortable));
  return count <= 1 ? [word] : balanced(words, count, widthOf).lines;
}
