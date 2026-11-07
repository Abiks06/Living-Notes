import { bestEntry, type LyricsEntry, plain, searches, type SongName } from './names';

const SERVICE = 'https://lrclib.net/api/search';
const CACHE_KEY = 'resonance.lyrics.cache';
const MAX_CACHED = 150;
const TIMEOUT_MS = 8000;
/** Lyrics get added all the time, so a miss is only believed for a while. */
const MISS_LASTS_MS = 7 * 24 * 3_600_000;

/** Timed lyrics, and how long the recording they were timed to is, in seconds. */
export interface FoundLyrics {
  lrc: string;
  duration: number;
}

interface Cached {
  at: number;
  /** Null if none were found. */
  found: FoundLyrics | null;
}

function readCache(): Record<string, Cached> {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? '{}');
    return typeof saved === 'object' && saved !== null ? (saved as Record<string, Cached>) : {};
  } catch {
    return {};
  }
}

function remember(key: string, found: FoundLyrics | null): void {
  const cache = { ...readCache(), [key]: { at: Date.now(), found } };
  const newest = Object.entries(cache)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_CACHED);
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(newest)));
  } catch {
    // Full or blocked: it'll be looked up again next time.
  }
}

export const songKey = (song: SongName) => `${plain(song.artist)}|${plain(song.title)}`;

/**
 * Finds a song's timed lyrics. Only the song's name is sent, and a song is only ever looked up
 * once. A failed request isn't remembered, so being offline doesn't count against the song.
 */
export async function findLyrics(song: SongName): Promise<FoundLyrics | null> {
  const key = songKey(song);
  const known = readCache()[key];
  if (known && (known.found || Date.now() - known.at < MISS_LASTS_MS)) return known.found ?? null;

  for (const query of searches(song)) {
    const response = await fetch(`${SERVICE}?${query}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
    });
    if (!response.ok) throw new Error(`Lyrics lookup failed: ${response.status}`);
    const answer: unknown = await response.json();
    if (!Array.isArray(answer)) throw new Error('Lyrics lookup gave no list');
    const entry = bestEntry(song, answer as LyricsEntry[]);
    if (entry?.syncedLyrics) {
      const found = { lrc: entry.syncedLyrics, duration: entry.duration };
      remember(key, found);
      return found;
    }
  }
  remember(key, null);
  return null;
}
