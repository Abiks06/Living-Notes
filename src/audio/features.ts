import { BAND_COUNT } from './bands';
import { CAST } from './cast';

export const FFT_SIZE = 2048;
export const BIN_COUNT = FFT_SIZE / 2;
/** Long window for pitch only: fine enough to separate semitones down to ~110 Hz. */
export const PITCH_FFT_SIZE = 8192;
/** Highest bin the UI draws (≈16 kHz at 44.1–48 kHz); anything above is never displayed. */
export const SPECTRUM_MAX_BIN = Math.floor(BIN_COUNT * 0.72);
/** The melody line shows this much either side of now, in this many steps. */
export const LINE_ROWS = 256;
export const LINE_PAST_S = 3;
export const LINE_AHEAD_S = 1.2;

/**
 * Everything the visuals need from the audio, refreshed once per frame.
 * A single shared instance is mutated in place, so reading it never allocates.
 */
export interface AudioFeatures {
  /** Smoothed (attack/release) band energies, 0–1, indexed by `BAND`. */
  readonly bands: Float32Array;
  /** Normalized band energies before smoothing, 0–1. */
  readonly rawBands: Float32Array;
  /** Byte frequency data straight from the analyser (or synthesized while idle). */
  readonly spectrum: Uint8Array<ArrayBuffer>;
  /** Overall loudness, 0–1. */
  level: number;
  /**
   * Overall drive, 0–1: bass-led in rhythmic music, level-led in tonal music, so a solo
   * violin moves the scene as well as a kick drum does.
   */
  energy: number;

  /** Broadband onset pulse: jumps to ~1 and decays to 0 over ~200 ms. */
  beat: number;
  /** How far the last onset cleared the adaptive threshold, 0–1. */
  beatStrength: number;
  /** Increments on every broadband onset. */
  beatCount: number;
  /** Current weighted spectral flux. */
  flux: number;
  /** Low-register hit (kick, bass note). */
  kick: number;
  /** Mid-register hit (snare, clap, piano or guitar attack). */
  snare: number;
  snareCount: number;
  /** The kick as motion should feel it: ahead of the sound when the song is known. */
  push: number;
  /** High-register hit (hats, cymbals). */
  hat: number;
  hatCount: number;

  /** 0 = silence or room noise, 1 = real signal. */
  gate: number;
  /** 0–1: this section's loudness against the loudest recent section. */
  intensity: number;
  loudnessDb: number;

  /** 0 = dark, 1 = bright, on a log-frequency axis. */
  centroid: number;
  /** 0 = tonal, 1 = noisy. */
  flatness: number;
  /** Energy per pitch class (C = 0), strongest = 1. */
  readonly chroma: Float32Array;
  pitchClass: number;
  /** 0 = no clear pitch, 1 = strongly pitched. */
  pitchConfidence: number;
  /** Increments when the harmony moves: the tonal counterpart of `beatCount`. */
  harmonyCount: number;
  /** 0–1: a pitched line in the vocal range, such as a singer, lead synth or melody. */
  vocal: number;

  bpm: number;
  /** 0–1 through the current beat. */
  beatPhase: number;
  /** Below `TEMPO_LOCKED` there is no reliable pulse (free time, ambient, rubato). */
  tempoConfidence: number;
  /** Counts tracked beats, for bar-length timing. */
  beatIndex: number;
  /** 0–3 position in the bar, where 0 is the 1. Only trust it above `BAR_LOCKED`. */
  barBeat: number;
  barConfidence: number;
  /** 1 normally, 0.5 when a fast groove is felt at half the tempo. */
  grooveScale: number;
  /** 0–1 through the beat as it's felt: what a nodding head follows. */
  groovePhase: number;
  /** Counts felt beats. */
  feltBeat: number;

  /** 0–1: the held breath when an expected kick goes missing before a drop. */
  inhale: number;
  /** 0–1: the kick that ended that breath, decaying. */
  impact: number;
  /** 0–1: how big the current drop is against the song's biggest. */
  dropPower: number;
  /** 0–1: the climb toward a drop. Only a known song has one. */
  tension: number;
  /** 0–1: time stopping in the instant before a drop. */
  hang: number;
  /** 0–1: inside the section a drop opened. */
  world: number;
  /** Which part of the song this is; sections that come back share a number. -1 if unknown. */
  sectionPart: number;

  /** 0–1: sound that holds, such as pads, organs and held chords. */
  sustain: number;
  /** 0–1: sound that moves in notes, such as riffs and arpeggios. */
  noteLevel: number;
  /** 0–1: the latest note, decaying. */
  noteHit: number;
  /** 0–1: where that note sits, from the bottom of a guitar upward. */
  notePitch: number;
  /** Increments on every note. */
  noteCount: number;
  /** 0–1: how harsh the notes are, from clean to distorted. */
  grit: number;
  /** How active each part is, in `CAST` order, before any solo. */
  readonly cast: Float32Array;

  /** 0–1 calm to intense, over a few seconds. */
  arousal: number;
  /** 0–1 dark to bright, over a few seconds. */
  brightness: number;
  /** Index into `VIBES`. */
  vibe: number;

  /** True when driven by real audio rather than the idle preview. */
  live: boolean;
  /** True when a score, not live analysis, is driving these features. */
  scored: boolean;
  /** The Living Visualizer switch: false shows the original reactive version, for comparing. */
  living: boolean;
  /** 0–1 how big this moment is against the whole song. 1 when the song isn't known. */
  presence: number;
  /** 0–1 where the melody sits, across three octaves from G3, or the song's own range. */
  melody: number;
  /** Pitch then level, 0–1, for each step across the melody line. Only a known song fills it. */
  readonly line: Float32Array;
}

export function createAudioFeatures(): AudioFeatures {
  return {
    bands: new Float32Array(BAND_COUNT),
    rawBands: new Float32Array(BAND_COUNT),
    spectrum: new Uint8Array(BIN_COUNT),
    level: 0,
    energy: 0,
    beat: 0,
    beatStrength: 0,
    beatCount: 0,
    flux: 0,
    kick: 0,
    push: 0,
    snare: 0,
    snareCount: 0,
    hat: 0,
    hatCount: 0,
    gate: 0,
    intensity: 0,
    loudnessDb: -120,
    centroid: 0.4,
    flatness: 0.5,
    chroma: new Float32Array(12),
    pitchClass: 0,
    pitchConfidence: 0,
    harmonyCount: 0,
    vocal: 0,
    barBeat: 0,
    barConfidence: 0,
    grooveScale: 1,
    groovePhase: 0,
    feltBeat: 0,
    inhale: 0,
    impact: 0,
    dropPower: 1,
    tension: 0,
    hang: 0,
    world: 0,
    sectionPart: -1,
    sustain: 0,
    noteLevel: 0,
    noteHit: 0,
    notePitch: 0.5,
    noteCount: 0,
    grit: 0,
    cast: new Float32Array(CAST.length),
    arousal: 0,
    brightness: 0.5,
    vibe: 0,
    bpm: 0,
    beatPhase: 0,
    tempoConfidence: 0,
    beatIndex: 0,
    live: false,
    scored: false,
    living: true,
    presence: 1,
    melody: 0.5,
    line: new Float32Array(LINE_ROWS * 2),
  };
}

/** The app-wide features object. Read it inside render loops; never copy it per frame. */
export const audioFeatures: AudioFeatures = createAudioFeatures();

if (import.meta.env.DEV) {
  (window as unknown as { __audioFeatures: AudioFeatures }).__audioFeatures = audioFeatures;
}
