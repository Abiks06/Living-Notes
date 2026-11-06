import { DEFAULT_WORD, MAX_TITLE_LENGTH, sanitizeWord } from '../settings/schema';
import type { ActiveSource } from '../state/appStore';

/** Time to take in a short word, and how much longer each letter of a long one needs. */
const READ_S = 1.6;
const READ_PER_LETTER_S = 0.05;
const MAX_READ_S = 3.2;

/** Shortens at a word boundary: half a word in glowing particles reads as a mistake. */
function fit(title: string): string {
  if (title.length <= MAX_TITLE_LENGTH) return title;
  const cut = title.slice(0, MAX_TITLE_LENGTH + 1).lastIndexOf(' ');
  return (cut > 0 ? title.slice(0, cut) : title.slice(0, MAX_TITLE_LENGTH)).trim();
}

const clean = (title: string) => sanitizeWord(fit(title), MAX_TITLE_LENGTH).trim();

/** How long a word has to stay up to be read. */
export function readingTime(word: string): number {
  return Math.min(MAX_READ_S, READ_S + Math.max(0, word.length - 12) * READ_PER_LETTER_S);
}

/** The song title inside a file name: "03 - Artist - Song (Remastered).mp3" gives "Song". */
export function titleFromFile(name: string): string {
  const bare = name
    .replace(/\.[^.]+$/, '')
    .replace(/[([{].*?[)\]}]/g, ' ')
    .replace(/_/g, ' ');
  const parts = bare
    .split(/\s+-\s+/)
    .map((part) => part.replace(/^\d+[\s.-]*/, '').trim())
    .filter(Boolean);
  return clean(parts[parts.length - 1] ?? '');
}

/** What a big drop spells: the visitor's own word if they chose one, else the track's name. */
export function flashWordFor(source: ActiveSource | null, word: string): string {
  const custom = word.trim();
  if (custom && custom !== DEFAULT_WORD) return custom;
  if (source?.kind === 'demo') return fit(source.title);
  if (source?.kind === 'file') {
    if (source.title) return clean(source.title) || DEFAULT_WORD;
    return titleFromFile(source.name) || DEFAULT_WORD;
  }
  return DEFAULT_WORD;
}
