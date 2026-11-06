import { cleanTitle } from '../library/tags';

/** One media session, as Windows reports it. */
export interface MediaSession {
  id: string;
  key: string;
  title: string;
  artist: string;
  album: string;
  status: string;
  canToggle: boolean;
  canNext: boolean;
  canPrevious: boolean;
}

/** This app's own session, which is never what system audio is listening to. */
const OWN_SESSION = 'app.livingnotes.resonance';

/**
 * Which session system audio is hearing. Something playing beats something paused, and the one
 * already showing wins a tie, so two apps playing at once don't swap back and forth.
 */
export function pickSession(
  sessions: readonly MediaSession[],
  currentId: string | null,
): MediaSession | null {
  const others = sessions.filter((session) => session.id !== OWN_SESSION && session.title);
  const playing = others.filter((session) => session.status === 'playing');
  const current = (list: readonly MediaSession[]) => list.find((s) => s.id === currentId);
  return current(playing) ?? playing[0] ?? current(others) ?? null;
}

/**
 * A song's name as it should be shown. Music apps report this properly. Plain YouTube gives the
 * channel as the artist and "Artist - Song (Official Video)" as the title.
 */
export function cleanSong(session: Pick<MediaSession, 'title' | 'artist'>): {
  title: string;
  artist: string;
} {
  const title = cleanTitle(session.title);
  const channel = session.artist
    .replace(/\s+-\s+Topic$/i, '')
    .replace(/VEVO$/, '')
    .trim();
  const split = title.indexOf(' - ');
  const named = split > 0 && !session.artist.endsWith(' - Topic');
  if (named) return { title: title.slice(split + 3).trim(), artist: title.slice(0, split).trim() };
  return { title, artist: channel };
}
