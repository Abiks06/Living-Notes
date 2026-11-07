/** One sung line. It's on screen from `time` to `end`, and silence between lines stays silent. */
export interface LyricLine {
  time: number;
  end: number;
  text: string;
}

const STAMP = /\[(\d+):(\d+(?:[.:]\d+)?)\]/g;
/** Time to sing a line, roughly, so a line before a long solo doesn't sit there through it. */
const MIN_LINE_S = 2.2;
const PER_CHARACTER_S = 0.11;
const MAX_LINE_S = 7;

/** Timed lyrics in LRC form, sorted, with each line given an end. Anything else is skipped. */
export function parseLyrics(lrc: string): LyricLine[] {
  const rows: { time: number; text: string }[] = [];
  for (const row of lrc.split(/\r?\n/)) {
    const stamps = [...row.matchAll(STAMP)];
    const last = stamps[stamps.length - 1];
    if (!last) continue;
    const text = row.slice((last.index ?? 0) + last[0].length).trim();
    for (const stamp of stamps) {
      const seconds = Number((stamp[2] ?? '').replace(':', '.'));
      rows.push({ time: Number(stamp[1]) * 60 + seconds, text });
    }
  }
  rows.sort((a, b) => a.time - b.time);

  const lines: LyricLine[] = [];
  rows.forEach((row, index) => {
    if (!row.text) return;
    const next = rows[index + 1]?.time ?? Infinity;
    const sung = Math.max(MIN_LINE_S, row.text.length * PER_CHARACTER_S);
    lines.push({ ...row, end: Math.min(next, row.time + Math.min(sung, MAX_LINE_S)) });
  });
  return lines;
}

/** The line being sung at this moment, or null in an instrumental stretch. */
export function lineAt(lines: readonly LyricLine[], time: number): LyricLine | null {
  let low = 0;
  let high = lines.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const line = lines[middle];
    if (!line) break;
    if (time < line.time) high = middle - 1;
    else if (time >= line.end) low = middle + 1;
    else return line;
  }
  return null;
}

/** The same lines, moved earlier or later. */
export function shifted(lines: readonly LyricLine[], seconds: number): LyricLine[] {
  return lines.map((line) => ({
    ...line,
    time: line.time + seconds,
    end: line.end + seconds,
  }));
}
