import { paletteFromImage } from '../library/art';
import { useLibrary } from '../library/library';
import { setSongColours } from '../settings/bindings';
import { type LiveSong, useAppStore } from '../state/appStore';
import { cleanSong, type MediaSession, pickSession } from './session';
import { SongClock } from './songClock';

type HelperMessage =
  { type: 'sessions'; sessions: MediaSession[] } | { type: 'art'; key: string; url: string };

export type LiveCommand = 'toggle' | 'next' | 'previous';

declare global {
  interface Window {
    /** Only the Windows app has this. */
    resonanceDesktop?: {
      nowPlaying: {
        start: () => void;
        stop: () => void;
        command: (verb: LiveCommand, id: string, title: string) => void;
        onUpdate: (listener: (message: HelperMessage) => void) => () => void;
      };
      keepAwake: (on: boolean) => void;
    };
  }
}

function toSong(session: MediaSession, art: string | null): LiveSong {
  return {
    ...cleanSong(session),
    key: session.key,
    id: session.id,
    reported: session.title,
    album: session.album,
    art,
    playing: session.status === 'playing',
    position: session.position,
    positionAt: session.updated,
    duration: session.duration,
    canToggle: session.canToggle,
    canNext: session.canNext,
    canPrevious: session.canPrevious,
  };
}

/** A timeline last updated this long before the song changed still belongs to the old song. */
const LEFT_OVER_MS = 1500;
/** A new song that claims to be further in than this hasn't had its timeline reset yet. */
const NEW_SONG_S = 6;

/** Enough for a few songs either way, as each picture can be hundreds of KB. */
const MAX_ART = 12;

const app = () => useAppStore.getState();

let colourJob = 0;

async function applyArtColours(song: LiveSong): Promise<void> {
  // A cover can be replaced while the last one is still being read, and the latest has to win.
  const job = ++colourJob;
  if (!song.art || !useLibrary.getState().artColours) {
    setSongColours(null);
    return;
  }
  const colours = await paletteFromImage(song.art);
  if (job === colourJob && app().liveSong?.key === song.key) setSongColours(colours);
}

/** How long a press is believed over what Windows still says, while the other app catches up. */
const PRESS_HOLDS_MS = 1500;
/** A press on play or pause: what it asked for, and where the song was when it was made. */
let pressed: {
  key: string;
  playing: boolean;
  position: number;
  at: number;
  until: number;
} | null = null;
/** Shows what Windows last reported again, set while system audio is being followed. */
let republish: (() => void) | null = null;

/** What the button should show: a press counts at once, until Windows agrees or time runs out. */
function withPress(song: LiveSong): LiveSong {
  if (!pressed || pressed.key !== song.key || Date.now() > pressed.until) {
    pressed = null;
    return song;
  }
  if (song.playing === pressed.playing) {
    pressed = null;
    return song;
  }
  // The place in the song is the press's too: a paused report is stale the moment play is
  // pressed, and carrying its old time forward would throw the lyrics ahead.
  return { ...song, playing: pressed.playing, position: pressed.position, positionAt: pressed.at };
}

/** Passes a button or key press on to the app that's playing. */
export function controlLive(verb: LiveCommand): void {
  const song = app().liveSong;
  if (!song) return;
  // A key press reaches here whatever the buttons show, and the app may not take this one.
  const allowed = { toggle: song.canToggle, next: song.canNext, previous: song.canPrevious }[verb];
  if (!allowed) return;
  window.resonanceDesktop?.nowPlaying.command(verb, song.id, song.reported);
  if (verb !== 'toggle') return;
  // The button answers the finger, not the other app: waiting for Windows to report the
  // change left it looking unpressed for up to a second.
  const now = Date.now();
  const playing = !song.playing;
  const position = song.playing
    ? song.position + Math.max(0, now - song.positionAt) / 1000
    : song.position;
  pressed = { key: song.key, playing, position, at: now, until: now + PRESS_HOLDS_MS };
  app().setLiveSong({ ...song, playing, position, positionAt: now });
  // If Windows never agrees, nothing else would put the button back.
  window.setTimeout(() => republish?.(), PRESS_HOLDS_MS + 50);
}

/** Follows what's playing on this PC, for as long as system audio is what's being heard. */
export function watchNowPlaying(): void {
  const bridge = window.resonanceDesktop?.nowPlaying;
  if (!bridge) return;

  let sessions: readonly MediaSession[] = [];
  let currentId: string | null = null;
  const art = new Map<string, string>();
  let clock = new SongClock();
  let clockKey: string | null = null;
  /** When this song took over from another in the same app, if it was seen to. */
  let changedAt = 0;

  /**
   * A session with its place in the song made trustworthy. An app names the next song a moment
   * before it resets its timeline, and until it does the position is the last song's.
   */
  const timed = (session: MediaSession): MediaSession => {
    if (session.key !== clockKey) {
      changedAt = clockKey !== null && currentId === session.id ? Date.now() : 0;
      clockKey = session.key;
      clock = new SongClock();
    }
    const leftOver =
      changedAt > 0 && session.updated < changedAt - LEFT_OVER_MS && session.position > NEW_SONG_S;
    if (leftOver) return { ...session, position: 0, duration: 0 };
    const playing = session.status === 'playing';
    const steady = clock.report(session.position, session.updated, playing);
    const limit = session.duration > 0 ? session.duration : Infinity;
    return { ...session, position: Math.min(limit, Math.max(0, steady)) };
  };

  const refresh = () => {
    if (app().source?.kind !== 'tab') return;
    const picked = pickSession(sessions, currentId);
    const session = picked ? timed(picked) : null;
    currentId = session?.id ?? null;
    const song = session ? withPress(toSong(session, art.get(session.key) ?? null)) : null;
    const before = app().liveSong;
    const newSong = song?.key !== before?.key;
    const newArt = song?.art !== before?.art;
    app().setLiveSong(song);
    // A new source is how everything else knows a new song has started.
    if (newSong) app().setSource({ kind: 'tab', title: song?.title, artist: song?.artist });
    if (song && (newSong || newArt)) void applyArtColours(song);
  };

  republish = refresh;

  bridge.onUpdate((message) => {
    if (message.type === 'sessions') {
      sessions = message.sessions;
    } else {
      art.set(message.key, message.url);
      const oldest = art.keys().next().value;
      if (art.size > MAX_ART && oldest !== undefined) art.delete(oldest);
    }
    refresh();
  });

  useAppStore.subscribe(({ source }, { source: before }) => {
    const listening = source?.kind === 'tab';
    if (listening === (before?.kind === 'tab')) return;
    if (listening) {
      // Otherwise Windows goes on showing the last local song as playing here.
      if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
      bridge.start();
    } else {
      bridge.stop();
      sessions = [];
      currentId = null;
      clockKey = null;
      pressed = null;
      app().setLiveSong(null);
    }
  });
}
