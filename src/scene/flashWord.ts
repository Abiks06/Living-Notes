import { DEFAULT_WORD, sanitizeWord } from '../settings/schema';
import type { ActiveSource } from '../state/appStore';

const MAX_LENGTH = 16;

/** Shortens at a word boundary: half a word in glowing particles reads as a mistake. */
function fit(title: string): string {
  if (title.length <= MAX_LENGTH) return title;
  const cut = title.slice(0, MAX_LENGTH + 1).lastIndexOf(' ');
  return (cut > 0 ? title.slice(0, cut) : title.slice(0, MAX_LENGTH)).trim();
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
  return sanitizeWord(fit(parts[parts.length - 1] ?? '')).trim();
}

/** What a big drop spells: the visitor's own word if they chose one, else the track's name. */
export function flashWordFor(source: ActiveSource | null, word: string): string {
  const custom = word.trim();
  if (custom && custom !== DEFAULT_WORD) return custom;
  if (source?.kind === 'demo') return fit(source.title);
  if (source?.kind === 'file') {
    if (source.title) return sanitizeWord(fit(source.title)).trim() || DEFAULT_WORD;
    return titleFromFile(source.name) || DEFAULT_WORD;
  }
  return DEFAULT_WORD;
}
