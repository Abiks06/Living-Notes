import { BAND_COUNT } from './bands';
import { AudioError } from './errors';
import { FeatureExtractor } from './featureExtractor';
import { audioFeatures, FFT_SIZE, PITCH_FFT_SIZE } from './features';
import { IdlePreview } from './idlePreview';
import { InputLeveller } from './inputLevel';
import { type Actor, readCast, soloActor } from './cast';
import type { Score } from './score/score';
import { ScorePlayer } from './score/scorePlayer';
import type { PlaybackHandle, Transport } from './sources';
import { MAX_DECIBELS, MIN_DECIBELS } from './tone';

const FADE_IN_S = 0.18;
const FADE_OUT_S = 0.12;
const FADE_STEPS = 32;
/** How far the form draws in as one song hands over to the next. */
const HANDOFF_BREATH = 0.55;
const MAX_DT = 0.1;

interface ActivePlayback {
  readonly handle: PlaybackHandle;
  readonly fader: GainNode;
}

export type FrameListener = (dt: number) => void;

export interface PlayOptions {
  /** Blend from the song before over this long, rather than a quick swap. */
  fadeS?: number;
  /** What's already known about this song, so it's performed from its first frame. */
  score?: Score | null;
}

/** Equal power, so two songs blending don't dip in the middle. */
function fadeCurve(rising: boolean, from = 1): Float32Array {
  return Float32Array.from({ length: FADE_STEPS }, (_, i) => {
    const x = i / (FADE_STEPS - 1);
    return from * (rising ? Math.sin((x * Math.PI) / 2) : Math.cos((x * Math.PI) / 2));
  });
}

/**
 * Owns the AudioContext and analysis graph, and refreshes `audioFeatures` once per frame
 * in `tick`, then notifies frame listeners (e.g. the spectrum strip) in the same pass.
 *
 * The WebGL scene drives `tick` from its render loop so features are always fresh before
 * particles read them; the engine only runs its own rAF loop when no scene is mounted.
 *
 *   source → fader ─┬─→ analyser
 *                   ├─→ speakers (volume)   (skipped for mic/tab audio: no feedback/echo)
 *                   └─→ record bus → MediaStream (pre-volume, so muting never mutes a clip)
 */
export class AudioEngine {
  /** Per-band sensitivity multipliers, applied after auto-gain normalisation. */
  readonly sensitivity = new Float32Array(BAND_COUNT).fill(1);
  /** False falls back to the original reactive version, so the two can be compared. */
  living = true;
  /** The one part left driving the picture, if any. */
  solo: Actor | null = null;

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private pitchAnalyser: AnalyserNode | null = null;
  private speakers: GainNode | null = null;
  /** Ahead of the analysers only, so a quiet stream is measured like a file. Never heard. */
  private inputLevel: GainNode | null = null;
  private readonly leveller = new InputLeveller();
  private recordDestination: MediaStreamAudioDestinationNode | null = null;
  private endedHandler: (() => void) | null = null;
  private extractor: FeatureExtractor | null = null;
  private readonly idle = new IdlePreview();
  private readonly player = new ScorePlayer();
  private score: Score | null = null;
  private scoreHandler: ((score: Score | null) => void) | null = null;
  private current: ActivePlayback | null = null;
  private requestId = 0;
  private readonly listeners: FrameListener[] = [];
  private externalClocks = 0;
  private frameId = 0;
  private lastFrame = 0;
  private volume = 1;
  private handoffLeft = 0;
  private handoffTotal = 1;
  private handoffPresence = 1;

  /** Starts the fallback rAF loop, unless an external clock (the scene) is attached. */
  startLoop(): void {
    if (this.frameId || this.externalClocks > 0) return;
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      const dt = (now - this.lastFrame) / 1000;
      this.lastFrame = now;
      this.tick(dt);
      this.frameId = requestAnimationFrame(loop);
    };
    this.frameId = requestAnimationFrame(loop);
  }

  /** Hands frame timing to an external loop. Returns a detach function. */
  attachClock(): () => void {
    this.externalClocks++;
    cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    return () => {
      this.externalClocks--;
      this.startLoop();
    };
  }

  /** Update features, then notify listeners. Allocation-free. */
  tick(dt: number): void {
    const step = Math.min(MAX_DT, Math.max(0.001, dt));
    this.update(step);
    for (let i = 0; i < this.listeners.length; i++) this.listeners[i]?.(step);
  }

  onFrame(listener: FrameListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  /**
   * Creates/resumes the AudioContext. Must run synchronously inside a user gesture
   * (Safari in particular only unlocks audio there).
   */
  unlock(): boolean {
    const ctx = this.ensureContext();
    if (!ctx) return false;
    if (ctx.state !== 'running') void ctx.resume();
    return true;
  }

  get isSupported(): boolean {
    return typeof AudioContext !== 'undefined';
  }

  /** Play/pause/seek for the current source; null for the microphone or when idle. */
  get currentScore(): Score | null {
    return this.score;
  }

  get transport(): Transport | null {
    return this.current?.handle.transport ?? null;
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.speakers && this.ctx) {
      this.speakers.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.02);
    }
  }

  /**
   * Swaps in a new source with a short crossfade. If another `play` call starts while
   * this one is still loading, the stale result is discarded.
   */
  async play(
    load: (ctx: AudioContext) => Promise<PlaybackHandle>,
    { fadeS = 0, score = null }: PlayOptions = {},
  ): Promise<boolean> {
    const ctx = this.ensureContext();
    const analyser = this.analyser;
    const speakers = this.speakers;
    if (!ctx || !analyser || !speakers) {
      throw new AudioError('audio-unsupported', 'Web Audio is not supported in this browser.');
    }
    if (ctx.state !== 'running') void ctx.resume();

    const request = ++this.requestId;
    const handle = await load(ctx);
    if (request !== this.requestId) {
      handle.stop();
      return false;
    }

    const blending = fadeS > 0 && this.current !== null;
    this.fadeOutCurrent(blending ? fadeS : FADE_OUT_S);
    const fader = ctx.createGain();
    fader.gain.setValueCurveAtTime(fadeCurve(true), ctx.currentTime, blending ? fadeS : FADE_IN_S);
    handle.node.connect(fader);
    fader.connect(this.inputLevel ?? analyser);
    if (handle.monitored) fader.connect(speakers);
    if (this.recordDestination && handle.recordable) fader.connect(this.recordDestination);

    const playback = { handle, fader };
    this.current = playback;
    this.setScore(score);
    // Live sources can end on their own ("Stop sharing", mic unplugged).
    handle.onEnded?.(() => {
      if (this.current !== playback) return;
      this.stop();
      this.endedHandler?.();
    });
    // A blend carries straight on: what's been learned about the room and level still holds.
    if (blending) {
      this.handoffTotal = fadeS;
      this.handoffLeft = fadeS;
      this.handoffPresence = audioFeatures.presence;
    } else {
      this.extractor?.reset(handle.acoustic === true);
      this.leveller.reset();
      if (this.inputLevel) this.inputLevel.gain.value = 1;
    }
    return true;
  }

  /** Hands over what's known about the current song; it's dropped when the source changes. */
  setScore(score: Score | null): void {
    this.score = score;
    this.player.reset();
    this.scoreHandler?.(score);
  }

  /** Called whenever what's known about the current song changes. */
  setScoreHandler(handler: ((score: Score | null) => void) | null): void {
    this.scoreHandler = handler;
  }

  /** Called when the current live source ends by itself. */
  setEndedHandler(handler: (() => void) | null): void {
    this.endedHandler = handler;
  }

  /** Audio for clip recording: everything the visuals react to, before the volume slider. */
  get recordingStream(): MediaStream | null {
    return this.recordDestination?.stream ?? null;
  }

  /** Stops the current source; visuals fall back to the idle preview. */
  stop(): void {
    this.requestId++;
    this.setScore(null);
    this.fadeOutCurrent();
  }

  private update(dt: number): void {
    const { analyser, pitchAnalyser, extractor } = this;
    if (this.current && analyser && pitchAnalyser && extractor && this.ctx?.state === 'running') {
      extractor.update(analyser, pitchAnalyser, dt, audioFeatures);
      this.levelInput(extractor.samples, dt);
      audioFeatures.scored = false;
      audioFeatures.titleDue = false;
      audioFeatures.hang = 0;
      audioFeatures.sectionPart = -1;
      this.performScore();
      this.performHandoff(dt);
      readCast(audioFeatures, audioFeatures.cast);
      if (this.solo) soloActor(audioFeatures, this.solo);
    } else {
      this.idle.update(dt, audioFeatures);
      audioFeatures.cast.fill(0);
    }
    audioFeatures.living = this.living;
  }

  /**
   * Sound from another app arrives at whatever volume that app is set to. A microphone is left
   * alone: its gate is tuned to real rooms, and turning a quiet room up would open it on noise.
   */
  private levelInput(samples: Float32Array, dt: number): void {
    const level = this.inputLevel;
    const handle = this.current?.handle;
    if (!level || !handle) return;
    const streamed = !handle.transport && handle.acoustic !== true;
    level.gain.value = streamed ? this.leveller.update(samples, level.gain.value, dt) : 1;
  }

  /** Performs the score against what's reaching the ears now. */
  private performScore(): void {
    const transport = this.transport;
    if (!this.living || !this.score || !transport || transport.paused) return;
    // Bluetooth can hold sound back by a fifth of a second; the picture has to wait for it.
    const delay = (this.ctx?.outputLatency ?? 0) + (this.ctx?.baseLatency ?? 0);
    this.player.apply(this.score, transport.currentTime() - delay, audioFeatures);
  }

  /** Carries the picture from one song to the next, so nothing about the change is a jump. */
  private performHandoff(dt: number): void {
    audioFeatures.handoff = 0;
    if (this.handoffLeft <= 0) return;
    this.handoffLeft = Math.max(0, this.handoffLeft - dt);
    const x = 1 - this.handoffLeft / this.handoffTotal;
    const eased = x * x * (3 - 2 * x);
    audioFeatures.handoff = Math.sin(Math.PI * x);
    audioFeatures.inhale = Math.max(audioFeatures.inhale, audioFeatures.handoff * HANDOFF_BREATH);
    audioFeatures.presence += (this.handoffPresence - audioFeatures.presence) * (1 - eased);
    audioFeatures.intensity = audioFeatures.presence;
  }

  private fadeOutCurrent(seconds = FADE_OUT_S): void {
    const playing = this.current;
    const ctx = this.ctx;
    this.current = null;
    if (!playing || !ctx) return;
    const { fader, handle } = playing;
    fader.gain.cancelScheduledValues(ctx.currentTime);
    fader.gain.setValueCurveAtTime(fadeCurve(false, fader.gain.value), ctx.currentTime, seconds);
    window.setTimeout(
      () => {
        handle.stop();
        fader.disconnect();
      },
      seconds * 1000 + 40,
    );
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (!this.isSupported) return null;

    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    // Keep transients: our own attack/release smoothing happens downstream.
    analyser.smoothingTimeConstant = 0.35;
    analyser.minDecibels = MIN_DECIBELS;
    analyser.maxDecibels = MAX_DECIBELS;

    // Long window for pitch: the band analyser's bins are wider than a semitone in the bass.
    const pitchAnalyser = ctx.createAnalyser();
    pitchAnalyser.fftSize = PITCH_FFT_SIZE;
    pitchAnalyser.smoothingTimeConstant = 0;
    pitchAnalyser.minDecibels = MIN_DECIBELS;
    pitchAnalyser.maxDecibels = MAX_DECIBELS;

    const inputLevel = ctx.createGain();
    inputLevel.connect(analyser);
    inputLevel.connect(pitchAnalyser);
    this.inputLevel = inputLevel;

    const speakers = ctx.createGain();
    speakers.gain.value = this.volume;
    speakers.connect(ctx.destination);
    // Older Safari lacks MediaStreamDestination; recording then degrades to video-only.
    this.recordDestination =
      typeof ctx.createMediaStreamDestination === 'function'
        ? ctx.createMediaStreamDestination()
        : null;

    this.ctx = ctx;
    this.analyser = analyser;
    this.pitchAnalyser = pitchAnalyser;
    this.speakers = speakers;
    this.extractor = new FeatureExtractor(ctx.sampleRate, this.sensitivity);
    return ctx;
  }
}

export const audioEngine = new AudioEngine();

if (import.meta.env.DEV) {
  (window as unknown as { __audioEngine: AudioEngine }).__audioEngine = audioEngine;
}
