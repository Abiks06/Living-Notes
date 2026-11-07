import { plain } from './names';
import type { LyricLine } from './lrc';

/** A few words to spell in the particles, right as they're sung. */
export interface LyricMoment {
  time: number;
  text: string;
}

/** Often enough to feel woven in, rarely enough that each one is an event. */
const MIN_GAP_S = 24;
const EARLIEST_S = 10;
const MAX_WORDS = 4;
const MAX_CHARACTERS = 26;
/** Letters this long stop reading as a word once they're made of particles. */
const LONG_WORD = 16;
const AFTER_A_REST_S = 3;

/** Words that would be a lot to put across someone's whole screen unasked. Full lyrics keeps them. */
const TOO_MUCH =
  /\b(?:fuck\w*|shit\w*|bitch\w*|nigg\w*|cunt\w*|dick\w*|pussy\w*|cock\w*|faggot\w*|whore\w*|hoes?|slut\w*|rape\w*|kill\w*)\b/i;

const DANGLING = new Set(
  'a an the my your our his her their that this these those to of in on at for from with and or but is are was were be than what when where who like so if as im youre ive'.split(
    ' ',
  ),
);
/** Sung sounds, which say nothing spelled out. */
const SOUNDS =
  /^(?:o+h*|a+h*|u+h*|m+|hm+|la+|na+h?|da+|yeah*|ye+|hey|ay+|woah|whoa|baby|look|wait)$/;

/**
 * The start of a line. Line times are when a line begins, so the opening words are the ones that
 * land on time; anything later in the line would be a guess.
 */
function opening(text: string): string {
  // Brackets are usually backing vocals, sung over the line rather than as part of it.
  const clause = (text.split(/[,;:–—([]|\s-\s/)[0] ?? text).trim();
  const words = clause.split(/\s+/);
  const kept: string[] = [];
  for (const word of words.slice(0, MAX_WORDS)) {
    if ([...kept, word].join(' ').length > MAX_CHARACTERS) break;
    kept.push(word);
  }
  // Cut short, a line can stop on "the" or "that", which reads like a mistake.
  while (kept.length > 1 && DANGLING.has(plain(kept[kept.length - 1] ?? ''))) kept.pop();
  return kept
    .join(' ')
    .replace(/^[("'“‘]+|[)"'”’.,!?…]+$/g, '')
    .trim();
}

function worthSpelling(text: string): boolean {
  const words = text.split(' ');
  if (words.length === 0 || text.length < 3) return false;
  // Censored by whoever typed the lyrics up.
  if (/[*#]/.test(text)) return false;
  if (
    plain(text)
      .split(/[\s-]+/)
      .every((word) => SOUNDS.test(word))
  )
    return false;
  if (words.some((word) => word.length > LONG_WORD)) return false;
  return !TOO_MUCH.test(text);
}

/** The words that carry a song are its repeated ones, and the lines it opens a section with. */
function weigh(text: string, sung: number, rested: boolean, title: string): number {
  const titleWords = new Set(plain(title).split(' ').filter(Boolean));
  const named = plain(text)
    .split(' ')
    .some((word) => titleWords.has(word));
  const short = text.split(' ').length <= 3;
  return Math.min(sung, 4) * 2 + (rested ? 2 : 0) + (named ? 3 : 0) + (short ? 1 : 0);
}

/** Picks where in a song its words surface. The same song always gets the same moments. */
export function pickMoments(lines: readonly LyricLine[], title: string): LyricMoment[] {
  const times = new Map<string, number>();
  for (const line of lines) {
    const key = plain(line.text);
    times.set(key, (times.get(key) ?? 0) + 1);
  }

  const candidates = lines.flatMap((line, index) => {
    const text = opening(line.text);
    if (line.time < EARLIEST_S || !worthSpelling(text)) return [];
    const before = lines[index - 1];
    const rested = !before || line.time - before.end >= AFTER_A_REST_S;
    const sung = times.get(plain(line.text)) ?? 1;
    return [{ time: line.time, text, weight: weigh(text, sung, rested, title) }];
  });

  const chosen: typeof candidates = [];
  const used = new Map<string, number>();
  // Best first, so spacing costs the song its filler rather than its hook.
  for (const candidate of [...candidates].sort((a, b) => b.weight - a.weight || a.time - b.time)) {
    const key = plain(candidate.text);
    const clear = chosen.every((other) => Math.abs(other.time - candidate.time) >= MIN_GAP_S);
    if (!clear || (used.get(key) ?? 0) >= 2) continue;
    chosen.push(candidate);
    used.set(key, (used.get(key) ?? 0) + 1);
  }
  return chosen.sort((a, b) => a.time - b.time).map(({ time, text }) => ({ time, text }));
}
