import { audioEngine } from '../audio/AudioEngine';
import { withoutCoverArt } from '../audio/flac';
import { scoreFromMix } from '../audio/score/loadScore';
import type { Score } from '../audio/score/score';
import { VOICE_SAMPLE_RATE } from '../audio/score/voices';
import { playMediaUrl } from '../audio/sources';
import { setSongColours } from '../settings/bindings';
import { learnSong, switchSource } from '../state/actions';
import { isLiveSource, useAppStore } from '../state/appStore';
import { artFor, paletteFor } from './art';
import { addLooseFiles, type Track, useLibrary } from './library';
import {
  addToQueue,
  advance,
  cycleRepeat,
  goBack,
  peekNext,
  playFrom,
  playNext as queueNext,
  type PlayQueue,
  setShuffle,
} from './queue';
import { readCachedScore, writeCachedScore } from './storage';

/** A quick blend for skipping, as anyone pressing next wants the new song now. */
const SKIP_FADE_S = 0.6;
const WATCH_MS = 250;
/** How long before the end the next song is announced. */
const COMING_UP_S = 12;
/** After this far into a song, previous restarts it rather than going back. */
const RESTART_AFTER_S = 3;
/** Leading silence worth skipping when a song starts. */
const MIN_LEAD_IN_S = 0.3;

const library = () => useLibrary.getState();
const app = () => useAppStore.getState();

/** Scores already in memory, for the song playing and the one coming up. */
const scores = new Map<string, Score>();
let learning: string | null = null;
let starting = 0;
let handingOver = false;

function setQueue(queue: PlayQueue): PlayQueue {
  library().setQueue(queue);
  return queue;
}

/** Decodes straight to the analysis rate: half the memory and half the work of full rate. */
async function analyse(file: File): Promise<Score> {
  const decoder = new OfflineAudioContext(2, 1, VOICE_SAMPLE_RATE);
  const score = await scoreFromMix(await decoder.decodeAudioData(await file.arrayBuffer()));
  void writeCachedScore(file, score);
  return score;
}

/** Learns the next song while this one plays, so it arrives already known. */
async function learnAhead(): Promise<void> {
  const next = peekNext(library().queue);
  if (!next || scores.has(next) || learning) return;
  const track = library().byId.get(next);
  if (!track) return;
  learning = next;
  try {
    const file = await withoutCoverArt(await track.open());
    const score = (await readCachedScore(file)) ?? (await analyse(file));
    scores.set(next, score);
  } catch {
    // It'll be learned when it plays, or the song simply stays reactive.
  } finally {
    learning = null;
  }
}

function keepOnly(ids: readonly (string | null)[]): void {
  for (const id of scores.keys()) if (!ids.includes(id)) scores.delete(id);
}

function describeSession(track: Track): void {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
  });
  void artFor(track, true).then((art) => {
    if (art && library().nowPlaying?.id === track.id && navigator.mediaSession.metadata) {
      navigator.mediaSession.metadata.artwork = [
        { src: art, sizes: '512x512', type: 'image/webp' },
      ];
    }
  });
}

async function start(track: Track, fadeS: number): Promise<boolean> {
  const request = ++starting;
  const picked = await track.open();
  const file = await withoutCoverArt(picked);
  const known = scores.get(track.id) ?? (await readCachedScore(file));
  if (request !== starting) return false;

  const url = URL.createObjectURL(file);
  handingOver = false;
  const played = await switchSource(
    track.title,
    (ctx) => playMediaUrl(ctx, url, { revokeOnStop: true, loop: false }),
    { fadeS, score: known ?? null },
  );
  if (!played) {
    URL.revokeObjectURL(url);
    return false;
  }
  if (request !== starting) return true;

  const lead = known?.musicStart ?? 0;
  if (lead >= MIN_LEAD_IN_S) audioEngine.transport?.seek(lead);
  library().setNowPlaying(track);
  library().setComingUp(null);
  app().setSource({
    kind: 'file',
    name: track.fileName,
    title: track.title,
    artist: track.artist,
  });
  describeSession(track);
  if (library().artColours) void paletteFor(track).then((colours) => setSongColours(colours));
  else setSongColours(null);

  keepOnly([track.id, peekNext(library().queue)]);
  if (known) {
    scores.set(track.id, known);
    void learnAhead();
  } else {
    learnSong(
      () => analyse(file),
      (score) => {
        scores.set(track.id, score);
        void learnAhead();
      },
    );
  }
  return true;
}

/** Plays a set of songs, from one of them or from the top. */
export function playTracks(ids: readonly string[], from: string | null): void {
  const queue = setQueue(playFrom(library().queue, ids, from));
  const track = queue.current ? library().byId.get(queue.current) : null;
  if (track) void start(track, library().nowPlaying ? SKIP_FADE_S : 0);
}

/** Plays what was dropped or picked; several files become a queue, in track-number order. */
export async function playFiles(files: readonly File[]): Promise<void> {
  const tracks = await addLooseFiles(files);
  const sorted = [...tracks].sort((a, b) =>
    a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' }),
  );
  playTracks(
    sorted.map((track) => track.id),
    sorted[0]?.id ?? null,
  );
}

function moveOn(skipped: boolean, fadeS: number): void {
  const queue = setQueue(advance(library().queue, skipped));
  const track = queue.current ? library().byId.get(queue.current) : null;
  if (track) {
    void start(track, fadeS);
    return;
  }
  // The end of the list, with repeat off.
  library().setNowPlaying(null);
  library().setComingUp(null);
  setSongColours(null);
  app().setSource(null);
  audioEngine.stop();
}

export function skipNext(): void {
  // Keys and media buttons land here too, and shouldn't start a song over what's being heard.
  if (isLiveSource(app().source)) return;
  moveOn(true, SKIP_FADE_S);
}

export function skipPrevious(): void {
  if (isLiveSource(app().source)) return;
  const transport = audioEngine.transport;
  if (transport && transport.currentTime() > RESTART_AFTER_S) {
    transport.seek(0);
    return;
  }
  const queue = setQueue(goBack(library().queue));
  const track = queue.current ? library().byId.get(queue.current) : null;
  if (track) void start(track, SKIP_FADE_S);
}

function announce(text: string): void {
  app().showNotice({ tone: 'info', title: text, body: '' });
}

/** Lines a song up to play straight after this one. */
export function queuePlayNext(id: string): void {
  setQueue(queueNext(library().queue, id));
  announce(`Playing next: ${library().byId.get(id)?.title ?? 'song'}`);
  void learnAhead();
}

export function queueAdd(id: string): void {
  setQueue(addToQueue(library().queue, id));
  announce(`Added to queue: ${library().byId.get(id)?.title ?? 'song'}`);
  void learnAhead();
}

export function toggleShuffle(): void {
  const queue = library().queue;
  setQueue(setShuffle(queue, !queue.shuffle));
  void learnAhead();
}

export function toggleRepeat(): void {
  setQueue(cycleRepeat(library().queue));
}

/** Where the music itself stops, which is often a while before the file does. */
function musicEnd(duration: number): number {
  const id = library().nowPlaying?.id;
  const score = id ? scores.get(id) : undefined;
  return score ? Math.min(duration, score.musicEnd) : duration;
}

/** Called when a song plays right to its end, which a crossfade would normally have beaten. */
export function onSongEnded(): void {
  if (library().nowPlaying) moveOn(false, 0);
}

/** A plain timer rather than the frame clock, because the page can be hidden while it plays. */
function watch(): void {
  const transport = audioEngine.transport;
  const { nowPlaying, queue, crossfade } = library();
  if (!transport || !nowPlaying || transport.paused) return;
  const left = musicEnd(transport.duration) - transport.currentTime();
  if (!Number.isFinite(left)) return;

  const nextId = peekNext(queue);
  const next = nextId ? (library().byId.get(nextId) ?? null) : null;
  const showing = left <= COMING_UP_S && next && next.id !== nowPlaying.id ? next : null;
  if (showing !== library().comingUp) library().setComingUp(showing);
  if (crossfade > 0 && next && !handingOver && left <= crossfade) {
    handingOver = true;
    moveOn(false, crossfade);
  }
}

function connectMediaKeys(): void {
  if (!('mediaSession' in navigator)) return;
  const session = navigator.mediaSession;
  session.setActionHandler('previoustrack', skipPrevious);
  session.setActionHandler('nexttrack', skipNext);
  session.setActionHandler('play', () => audioEngine.transport?.play());
  session.setActionHandler('pause', () => audioEngine.transport?.pause());
  session.setActionHandler('seekto', (details) => {
    if (details.seekTime !== undefined) audioEngine.transport?.seek(details.seekTime);
  });
}

/** Starts the player's background work. */
export function startPlayer(): void {
  connectMediaKeys();
  window.setInterval(watch, WATCH_MS);
}
