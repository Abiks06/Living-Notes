import { create } from 'zustand';
import { audioEngine } from '../audio/AudioEngine';
import { SCORE_RATE } from '../audio/score/sections';
import { useLibrary } from '../library/library';
import { nameParts } from '../library/tags';
import { useAppStore } from '../state/appStore';
import { lyricShift } from './align';
import { type LyricLine, parseLyrics, shifted } from './lrc';
import { findLyrics, songKey } from './lookup';
import { type LyricMoment, pickMoments } from './moments';
import type { SongName } from './names';

export const LYRICS_MODES = [
  { key: 'off', label: 'Off', hint: 'No lyrics, and nothing looked up' },
  { key: 'moments', label: 'Moments', hint: 'Words surface in the visuals here and there' },
  { key: 'full', label: 'Full', hint: 'Every line as it’s sung' },
] as const;

export type LyricsMode = (typeof LYRICS_MODES)[number]['key'];

const MODE_KEY = 'resonance.lyrics.mode';
const OFFERED_KEY = 'resonance.lyrics.offered';

function savedMode(): LyricsMode {
  try {
    const saved = window.localStorage.getItem(MODE_KEY);
    return LYRICS_MODES.find((mode) => mode.key === saved)?.key ?? 'off';
  } catch {
    return 'off';
  }
}

function wasOffered(): boolean {
  try {
    return window.localStorage.getItem(OFFERED_KEY) === '1';
  } catch {
    return false;
  }
}

function keep(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // It still holds for this visit.
  }
}

interface LyricsState {
  mode: LyricsMode;
  /** The one-time question has been asked. */
  offered: boolean;
  status: 'idle' | 'looking' | 'found' | 'none';
  /** This song's lines, moved to fit this copy of it. */
  lines: readonly LyricLine[];
  moments: readonly LyricMoment[];
  /** A lyric the particles should have ready to spell. */
  spell: string | null;
  setMode: (mode: LyricsMode) => void;
  setOffered: () => void;
}

export const useLyrics = create<LyricsState>()((set) => ({
  mode: savedMode(),
  offered: wasOffered(),
  status: 'idle',
  lines: [],
  moments: [],
  spell: null,
  setMode: (mode) => {
    keep(MODE_KEY, mode);
    keep(OFFERED_KEY, '1');
    set({ mode, offered: true });
  },
  setOffered: () => {
    keep(OFFERED_KEY, '1');
    set({ offered: true });
  },
}));

/** The song being heard, as far as anyone can tell. */
export function currentSong(): SongName | null {
  const { source, liveSong } = useAppStore.getState();
  if (source?.kind === 'tab' && liveSong?.title) {
    return { title: liveSong.title, artist: liveSong.artist, duration: liveSong.duration };
  }
  if (source?.kind !== 'file') return null;
  const track = useLibrary.getState().nowPlaying;
  if (track) return { title: track.title, artist: track.artist, duration: track.duration };
  const named = nameParts(source.name);
  return {
    title: source.title ?? named.title,
    artist: source.artist ?? named.artist ?? '',
    duration: 0,
  };
}

/** Past when a moment is prepared, so one that's about to land keeps its word. */
const HOLD_WORD_S = 2;

let wanted: string | null = null;
let raw: readonly LyricLine[] = [];
/** How long the recording they were timed to is. */
let timedTo = 0;
let title = '';
let firing: string | null = null;

function show(lines: readonly LyricLine[]): void {
  useLyrics.setState({ lines, moments: pickMoments(lines, title) });
}

/** Lyrics are timed to someone else's copy, so once this one's voice is known, they're fitted. */
export function alignLyrics(): void {
  const score = audioEngine.currentScore;
  if (raw.length === 0 || !score?.hasVoice || timedTo <= 0) return;
  show(shifted(raw, lyricShift(raw, score.voice, SCORE_RATE, score.duration - timedTo)));
}

function clear(): void {
  raw = [];
  firing = null;
  useLyrics.setState({ status: 'idle', lines: [], moments: [], spell: null });
}

function refresh(): void {
  const song = useLyrics.getState().mode === 'off' ? null : currentSong();
  const key = song ? songKey(song) : null;
  if (key === wanted) return;
  wanted = key;
  clear();
  if (!song || !key) return;

  title = song.title;
  useLyrics.setState({ status: 'looking' });
  findLyrics(song)
    .then((found) => {
      if (key !== wanted) return;
      raw = found ? parseLyrics(found.lrc) : [];
      timedTo = found?.duration ?? 0;
      useLyrics.setState({ status: raw.length > 0 ? 'found' : 'none' });
      show(raw);
      alignLyrics();
    })
    .catch(() => {
      // Offline, or the service is down: the music plays on without words.
      if (key === wanted) useLyrics.setState({ status: 'idle' });
    });
}

export function startLyrics(): void {
  useAppStore.subscribe(refresh);
  useLibrary.subscribe(refresh);
  useLyrics.subscribe(({ mode }, before) => {
    if (mode !== before.mode) refresh();
  });
}

/** Longer than any song: past this the last report is stale, not a position. */
const MAX_CARRY_S = 1800;

/** Where the live app says it is now, carried forward from when it last said so. */
export function livePosition(
  position: number,
  positionAt: number,
  playing: boolean,
  now: number,
): number {
  // An app that stops reporting can't run the words on past where the song could be.
  const carried = Math.min(MAX_CARRY_S, Math.max(0, (now - positionAt) / 1000));
  return playing ? position + carried : position;
}

/** Where in the song this moment is, or null if it's stopped or nobody can say. */
export function songTime(): number | null {
  const transport = audioEngine.transport;
  if (transport) return transport.paused ? null : transport.currentTime();
  const { liveSong } = useAppStore.getState();
  if (!liveSong?.playing || liveSong.duration <= 0) return null;
  // An app that has said nothing for this long has stopped reporting, not kept playing.
  if (Date.now() - liveSong.positionAt > MAX_CARRY_S * 1000) return null;
  const time = livePosition(liveSong.position, liveSong.positionAt, true, Date.now());
  // Past its own end the report is wrong, and no line is better than the wrong one.
  return time <= liveSong.duration + 1 ? time : null;
}

/** A moment that's coming up, and how many seconds away it is. */
export function nextMoment(): { text: string; in: number } | null {
  const { mode, moments } = useLyrics.getState();
  if (mode !== 'moments' || moments.length === 0) return null;
  const time = songTime();
  if (time === null) return null;
  for (const moment of moments) {
    const away = moment.time - time;
    if (away > 0) return { text: moment.text, in: away };
  }
  return null;
}

export function prepareMoment(text: string): void {
  firing = text;
  if (useLyrics.getState().spell !== text) useLyrics.setState({ spell: text });
}

/** Hands the word back once the lyric has been and gone. */
export function spokenMoment(wordShowing: boolean): void {
  if (firing === null || wordShowing) return;
  const upcoming = nextMoment();
  // Still on its way. The same line coming round again later doesn't count.
  if (upcoming?.text === firing && upcoming.in <= HOLD_WORD_S) return;
  firing = null;
  useLyrics.setState({ spell: null });
}
