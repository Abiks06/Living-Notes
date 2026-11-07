/** What's known about a song, from its tags, its file name or the app playing it. */
export interface SongName {
  title: string;
  artist: string;
  /** Seconds, or 0 if it isn't known. */
  duration: number;
}

/** One song in a lyrics service's answer. */
export interface LyricsEntry {
  trackName: string;
  artistName: string;
  duration: number;
  instrumental: boolean;
  syncedLyrics: string | null;
}

/** Bracketed notes that don't change which recording this is. */
const HARMLESS =
  /^(?:official.*|.*\bvideo\b.*|.*\baudio\b.*|.*\blyrics?\b.*|visuali[sz]er|flac|mp3|wav|hd|hq|4k|\d+\s*kbps|explicit|clean|.*\bremaster(?:ed)?\b.*|album version|single version|original mix|bonus track|prod\b.*|feat\b.*|ft\b.*|featuring\b.*|with\s.*)$/i;
/** Words that mean a different recording, with different timing. */
const VERSIONS = /\b(?:live|acoustic|remix|instrumental|slowed|sped up|nightcore|demo|karaoke)\b/i;
const FEATURING = /\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i;

/** The song's own name: no file-sharing notes, no guests. Versions stay, as they matter. */
export function bareTitle(title: string): string {
  const unbracketed = title.replace(/[([{]([^)\]}]*)[)\]}]/g, (whole, inside: string) =>
    HARMLESS.test(inside.trim()) ? ' ' : whole,
  );
  const bare = unbracketed
    .replace(FEATURING, '')
    .replace(/\s+-\s+\d{4}\s+remaster\S*.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return bare || title.trim();
}

/** Spelling and punctuation dropped, so only the words themselves are compared. */
export function plain(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/['’`]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      // File names often lose their apostrophes: "Don_t" arrives here as "don t".
      .replace(/(\p{L}n) t(?= |$)/gu, '$1t')
      .trim()
  );
}

const words = (text: string) => plain(text).split(' ').filter(Boolean);

/** 0-1: how many words two names share. */
export function likeness(a: string, b: string): number {
  const first = words(a);
  const second = new Set(words(b));
  if (first.length === 0 || second.size === 0) return 0;
  const shared = first.filter((word) => second.has(word)).length;
  return (2 * shared) / (first.length + second.size);
}

/** 0-1: one artist line against another. "Metro Boomin, 21 Savage" still contains 21 Savage. */
function artistLikeness(ours: string, theirs: string): number {
  const mine = words(ours);
  const other = new Set(words(theirs));
  if (mine.length === 0 || other.size === 0) return 0;
  const contained = mine.filter((word) => other.has(word)).length / mine.length;
  const reverse = [...other].filter((word) => mine.includes(word)).length / other.size;
  return Math.max(contained, reverse);
}

/** 0-1: lengths within a couple of seconds are one recording; past fifteen they aren't. */
function lengthLikeness(ours: number, theirs: number): number {
  if (ours <= 0 || theirs <= 0) return 0.5;
  const apart = Math.abs(ours - theirs);
  if (apart <= 2) return 1;
  return Math.max(0, 1 - (apart - 2) / 13);
}

const MIN_TITLE = 0.7;
const MIN_ARTIST = 0.5;

function fit(entry: LyricsEntry, title: string, artist: string, duration: number): number {
  const titleFit = likeness(bareTitle(entry.trackName), title);
  if (titleFit < MIN_TITLE) return 0;
  const artistFit = artist ? artistLikeness(artist, entry.artistName) : 0;
  // A title alone is a guess, so with no artist the length has to agree.
  const lengthFit = lengthLikeness(duration, entry.duration);
  if (artist ? artistFit < MIN_ARTIST : lengthFit < 0.8) return 0;
  const sameVersion = VERSIONS.test(entry.trackName) === VERSIONS.test(title);
  return (titleFit * 2 + artistFit * 2 + lengthFit * 3) * (sameVersion ? 1 : 0.5);
}

/**
 * A name with no separator, like "Song Name Artist Name Remix", where which words are which is
 * anyone's guess. It counts if the entry's song and artist are both all in there.
 */
function fitsJumble(entry: LyricsEntry, jumble: string): number {
  const all = new Set(words(jumble));
  const song = words(bareTitle(entry.trackName));
  const artist = words(entry.artistName);
  if (song.length === 0 || !song.every((word) => all.has(word))) return 0;
  const heard = artist.filter((word) => all.has(word)).length / Math.max(1, artist.length);
  return heard >= MIN_ARTIST ? song.length + heard : 0;
}

/**
 * The entry that's most surely this recording, or null if none is sure enough. A wrong song's
 * words over the music would be worse than none. Files are often named "Song - Artist", so
 * both ways round are tried.
 */
export function bestEntry(song: SongName, entries: readonly LyricsEntry[]): LyricsEntry | null {
  const title = bareTitle(song.title);
  let best: LyricsEntry | null = null;
  let bestFit = 0;
  for (const entry of entries) {
    if (!entry.syncedLyrics || entry.instrumental) continue;
    const named = fit(entry, title, song.artist, song.duration);
    const swapped = song.artist ? fit(entry, bareTitle(song.artist), song.title, song.duration) : 0;
    const jumbled = song.artist ? 0 : fitsJumble(entry, title);
    const score = Math.max(named, swapped, jumbled);
    if (score > bestFit) {
      best = entry;
      bestFit = score;
    }
  }
  return best;
}

/** What to ask for, most exact first. Each is a query string, as the service expects it. */
export function searches(song: SongName): string[] {
  const title = bareTitle(song.title);
  const artist = bareTitle(song.artist);
  const query = (params: Record<string, string>) => new URLSearchParams(params).toString();
  if (!artist) return [query({ q: title })];
  return [
    query({ track_name: title, artist_name: artist }),
    query({ track_name: artist, artist_name: title }),
    query({ q: `${artist} ${title}` }),
  ];
}
