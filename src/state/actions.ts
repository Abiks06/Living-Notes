import { audioEngine, type PlayOptions } from '../audio/AudioEngine';
import type { Actor } from '../audio/cast';
import { DEFAULT_DEMO, findDemo, isTrackFileAvailable } from '../audio/demoTracks';
import { AudioError, toAudioError } from '../audio/errors';
import { openMicrophone, openTabAudio, playBuffer, playMediaUrl } from '../audio/sources';
import { scoreFromMix, scoreFromStems } from '../audio/score/loadScore';
import type { Score } from '../audio/score/score';
import { summarise } from '../audio/score/songMap';
import { renderProofSong } from '../audio/synth/proofSong';
import { renderDemoLoop } from '../audio/synth/renderLoop';
import { IS_DESKTOP, LIVE_AUDIO_LABEL } from '../lib/desktop';
import { useLibrary } from '../library/library';
import { controlLive } from '../live/nowPlaying';
import { onSongEnded, startPlayer } from '../library/player';
import { restoreLibrary } from '../library/library';
import { setSongColours } from '../settings/bindings';
import { isLiveSource, useAppStore } from './appStore';

const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus)$/i;

const store = () => useAppStore.getState();

/** Warm up the first demo (file check + synth render) so the first click plays instantly. */
export function prepareAudio(): void {
  audioEngine.startLoop();
  audioEngine.setEndedHandler(onLiveSourceEnded);
  startPlayer();
  void restoreLibrary();
  audioEngine.setScoreHandler((score) => {
    // A song going away also abandons anything still being learned about it.
    if (!score) {
      scoreRequest++;
      store().setLearning(false);
    }
    store().setSong(score ? summarise(score) : null);
  });
  void isTrackFileAvailable(DEFAULT_DEMO);
  if (typeof OfflineAudioContext !== 'undefined') {
    renderDemoLoop(DEFAULT_DEMO.fallback).catch(() => undefined);
  }
}

/**
 * Leaves the intro and unlocks audio. Every control calls this synchronously from its
 * click handler, so whichever button the visitor presses first counts as the gesture.
 */
export function ensureStarted(): boolean {
  if (store().phase === 'intro') store().setPhase('running');
  const unlocked = audioEngine.unlock();
  if (!unlocked) reportError(new AudioError('audio-unsupported', 'Web Audio is not supported.'));
  return unlocked;
}

/** Runs from the "Click to start" overlay or a demo preset. */
export function startExperience(demoId: string = DEFAULT_DEMO.id): void {
  if (ensureStarted()) void selectDemo(demoId);
}

let scoreRequest = 0;
/** Within this long of a section's start, going back means the section before it. */
const SECTION_RESTART_S = 1.5;

/** Learns the song in the background, while it's already playing. */
export function learnSong(analyse: () => Promise<Score>, learned?: (score: Score) => void): void {
  const request = ++scoreRequest;
  store().setLearning(true);
  // A frame's grace first, so the first beats aren't competing with the analysis.
  window.setTimeout(() => {
    analyse()
      .then((score) => {
        if (request !== scoreRequest) return;
        audioEngine.setScore(score);
        learned?.(score);
      })
      .catch(() => undefined) // Without a score the app simply reacts live.
      .finally(() => {
        if (request === scoreRequest) store().setLearning(false);
      });
  }, 50);
}

/** Leaves one part driving the picture, or brings everything back if it already is. */
export function toggleSolo(actor: Actor): void {
  const solo = store().solo === actor ? null : actor;
  audioEngine.solo = solo;
  store().setSolo(solo);
}

/** Moves to the next section, or back to the start of this one, then the one before. */
export function jumpSection(step: 1 | -1): void {
  const song = store().song;
  const transport = audioEngine.transport;
  if (!song || !transport) return;
  const now = transport.currentTime();
  const starts = song.sections.map((section) => section.start);
  const target =
    step > 0
      ? starts.find((start) => start > now + 0.1)
      : [...starts].reverse().find((start) => start < now - SECTION_RESTART_S);
  if (target !== undefined) seekTo(target);
}

/** Leaving the music library for a demo or live input: its song no longer owns the picture. */
function forgetSong(): void {
  useLibrary.getState().setNowPlaying(null);
  useLibrary.getState().setComingUp(null);
  setSongColours(null);
}

export function toggleLiving(): void {
  audioEngine.living = !audioEngine.living;
  store().showNotice({
    tone: 'info',
    title: audioEngine.living ? 'Living Visualizer' : 'Original visualizer',
    body: audioEngine.living
      ? 'It knows the song. Press B to compare.'
      : 'Reacting live, as it used to. Press B to compare.',
  });
}

export async function selectDemo(id: string): Promise<void> {
  const track = findDemo(id);
  if (!track) return;
  let analyse: (() => Promise<Score>) | null = null;
  await switchSource(track.title, async (ctx) => {
    if (track.proof) {
      const song = await renderProofSong();
      analyse = () => scoreFromStems(song.stems, song.mix);
      return playBuffer(ctx, song.mix);
    }
    if (await isTrackFileAvailable(track)) return playMediaUrl(ctx, track.url);
    const loop = await renderDemoLoop(track.fallback);
    analyse = () => scoreFromMix(loop);
    return playBuffer(ctx, loop);
  }).then((ok) => {
    if (ok && analyse) learnSong(analyse);
    if (ok) {
      forgetSong();
      store().setSource({ kind: 'demo', id: track.id, title: track.title });
    }
  });
}

export function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || AUDIO_EXTENSIONS.test(file.name);
}

export async function enableMic(): Promise<void> {
  store().setMic('requesting');
  const device = store().micDevice;
  const ok = await switchSource('Microphone', (ctx) => openMicrophone(ctx, device));
  if (ok) {
    store().setMic('live');
    forgetSong();
    store().setSource({ kind: 'mic' });
  } else if (store().mic === 'requesting') {
    store().setMic('idle');
  }
  // A chosen input that has gone away: "Try again" should reach for what's still there.
  if (!ok && device && store().mic === 'missing') store().setMicDevice(null);
}

/** Visualize another tab or the system audio (Chrome/Edge desktop). */
export async function enableTabAudio(): Promise<void> {
  const ok = await switchSource(LIVE_AUDIO_LABEL, openTabAudio);
  if (ok) {
    forgetSong();
    store().setSource({ kind: 'tab' });
  }
}

/** "Stop sharing" was pressed or the mic disappeared: explain, then fall back to a demo. */
function onLiveSourceEnded(): void {
  const kind = store().source?.kind;
  if (kind === 'file') {
    onSongEnded();
    return;
  }
  store().setSource(null);
  if (kind === 'mic') store().setMic('idle');
  // Switching source clears notices, so this one has to come after the switch begins.
  void selectDemo(DEFAULT_DEMO.id);
  store().showNotice({
    tone: 'info',
    title: kind === 'tab' ? 'Tab sharing stopped' : 'Microphone disconnected',
    body: 'Back to the demo track. Pick a source below to switch again.',
  });
}

/** Leaves the mic (or a failed source) and returns to the default demo. */
export function backToDemo(): void {
  const { source, dismissNotice, setMic } = store();
  dismissNotice();
  setMic('idle');
  // A track is still playing underneath the mic prompt; keep it rather than restarting.
  if (!source || source.kind === 'mic') void selectDemo(DEFAULT_DEMO.id);
}

/** Switches input; if the mic is on, the new device takes over straight away. */
export function selectMicDevice(id: string | null): void {
  store().setMicDevice(id);
  if (store().source?.kind === 'mic') void enableMic();
}

export function togglePlayback(): void {
  if (isLiveSource(store().source)) {
    controlLive('toggle');
    return;
  }
  const transport = audioEngine.transport;
  if (!transport) return;
  if (transport.paused) transport.play();
  else transport.pause();
  store().setPaused(transport.paused);
}

export function seekTo(seconds: number): void {
  audioEngine.transport?.seek(seconds);
}

export function setVolume(volume: number): void {
  store().setVolume(volume);
  store().setMuted(volume === 0);
  audioEngine.setVolume(volume);
}

export function toggleMute(): void {
  const { muted, volume, setMuted } = store();
  const nextMuted = !muted;
  setMuted(nextMuted);
  // Unmuting from a zero slider would stay silent; bring it back to a usable level.
  const restored = volume === 0 ? 0.6 : volume;
  if (!nextMuted && volume === 0) store().setVolume(restored);
  audioEngine.setVolume(nextMuted ? 0 : restored);
}

export async function switchSource(
  label: string,
  load: Parameters<typeof audioEngine.play>[0],
  options?: PlayOptions,
): Promise<boolean> {
  store().setLoading(label);
  store().dismissNotice();
  scoreRequest++;
  try {
    const applied = await audioEngine.play(load, options);
    if (applied) store().setPaused(false);
    if (applied && label !== 'Microphone' && store().mic !== 'idle') store().setMic('idle');
    return applied;
  } catch (error) {
    reportError(error);
    return false;
  } finally {
    if (store().loading === label) store().setLoading(null);
  }
}

function reportError(error: unknown): void {
  const audioError = toAudioError(error);
  const s = store();
  if (import.meta.env.DEV) console.warn('[resonance]', audioError, audioError.cause);

  switch (audioError.kind) {
    case 'mic-denied':
      s.setMic('denied');
      return;
    case 'mic-unsupported':
      s.setMic('unsupported');
      return;
    case 'mic-missing':
      s.setMic('missing');
      return;
    case 'mic-busy':
      s.setMic('busy');
      return;
    case 'tab-cancelled':
      // The visitor closed the share dialog; nothing went wrong.
      return;
    case 'tab-no-audio':
      s.showNotice({
        tone: 'info',
        title: IS_DESKTOP ? 'No sound to listen to' : 'No audio was shared',
        body: IS_DESKTOP
          ? 'Windows didn’t offer any sound. Check that an output device is connected.'
          : 'In the share dialog, pick a browser tab and switch on “Share tab audio”. Windows can share system audio from the “Entire screen” option.',
      });
      return;
    case 'tab-unsupported':
      s.showNotice({
        tone: 'info',
        title: IS_DESKTOP ? 'System audio didn’t start' : 'Tab audio needs Chrome or Edge',
        body: IS_DESKTOP
          ? 'Windows wouldn’t share its sound. Use a demo track, your mic, or drop in a file instead.'
          : 'This browser can’t share another tab’s sound. Use a demo track, your mic, or drop in a file instead.',
      });
      return;
    case 'decode':
      s.showNotice({
        tone: 'error',
        title: 'Couldn’t play that file',
        body: 'Your browser can’t decode it. MP3, WAV and OGG work everywhere; try one of those.',
      });
      return;
    case 'autoplay-blocked':
      s.showNotice({
        tone: 'info',
        title: 'Tap to play',
        body: 'Your browser paused audio until you interact. Pick a track below to start it.',
      });
      return;
    case 'audio-unsupported':
      s.showNotice({
        tone: 'error',
        title: 'Audio isn’t available',
        body: 'This browser doesn’t support the Web Audio API, so visuals run on a built-in preview groove.',
      });
      return;
    case 'unknown':
      s.showNotice({
        tone: 'error',
        title: 'Something went wrong',
        body: 'The audio source couldn’t start. Try another track or reload the page.',
      });
  }
}
