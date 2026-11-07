import { paletteFromImage } from '../library/art';
import { useLibrary } from '../library/library';
import { setSongColours } from '../settings/bindings';
import { type LiveSong, useAppStore } from '../state/appStore';
import { cleanSong, type MediaSession, pickSession } from './session';

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

/** Enough for a few songs either way, as each picture can be hundreds of KB. */
const MAX_ART = 12;

const app = () => useAppStore.getState();

async function applyArtColours(song: LiveSong): Promise<void> {
  if (!song.art || !useLibrary.getState().artColours) {
    setSongColours(null);
    return;
  }
  const colours = await paletteFromImage(song.art);
  if (app().liveSong?.key === song.key) setSongColours(colours);
}

/** Passes a button or key press on to the app that's playing. */
export function controlLive(verb: LiveCommand): void {
  const song = app().liveSong;
  if (song) window.resonanceDesktop?.nowPlaying.command(verb, song.id, song.reported);
}

/** Follows what's playing on this PC, for as long as system audio is what's being heard. */
export function watchNowPlaying(): void {
  const bridge = window.resonanceDesktop?.nowPlaying;
  if (!bridge) return;

  let sessions: readonly MediaSession[] = [];
  let currentId: string | null = null;
  const art = new Map<string, string>();

  const refresh = () => {
    if (app().source?.kind !== 'tab') return;
    const session = pickSession(sessions, currentId);
    currentId = session?.id ?? null;
    const song = session ? toSong(session, art.get(session.key) ?? null) : null;
    const before = app().liveSong;
    const newSong = song?.key !== before?.key;
    const newArt = song?.art !== before?.art;
    app().setLiveSong(song);
    // A new source is how everything else knows a new song has started.
    if (newSong) app().setSource({ kind: 'tab', title: song?.title, artist: song?.artist });
    if (song && (newSong || newArt)) void applyArtColours(song);
  };

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
      app().setLiveSong(null);
    }
  });
}
