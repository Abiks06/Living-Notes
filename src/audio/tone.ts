import { clamp01 } from './envelope';

/** dB span of the analysers; bytes map linearly across it. */
export const MIN_DECIBELS = -90;
export const MAX_DECIBELS = -15;

const CENTROID_LOW_HZ = 80;
const CENTROID_HIGH_HZ = 10000;
const FLATNESS_LOW_HZ = 200;
const FLATNESS_HIGH_HZ = 6000;
/** 40 dB: bins further below the peak than this count as empty. */
const FLATNESS_RANGE_BYTES = Math.round((40 / (MAX_DECIBELS - MIN_DECIBELS)) * 255);
/** Geometric/arithmetic ratios of a clear tone and of noise, mapped onto 0–1. */
const TONE_RATIO = 0.25;
const NOISE_RATIO = 0.65;
const CHROMA_LOW_HZ = 110;
const CHROMA_HIGH_HZ = 2000;

/** Byte → linear amplitude. Bytes are dB, so this is a cheap lookup. */
export const AMPLITUDE = new Float32Array(256);
for (let byte = 0; byte < 256; byte++) {
  const db = MIN_DECIBELS + (byte / 255) * (MAX_DECIBELS - MIN_DECIBELS);
  AMPLITUDE[byte] = byte === 0 ? 0 : 10 ** (db / 20);
}

/** Amplitude of a bin N bytes below the peak, and its logarithm. */
const RELATIVE_AMPLITUDE = new Float32Array(FLATNESS_RANGE_BYTES + 1);
const RELATIVE_LOG = new Float32Array(FLATNESS_RANGE_BYTES + 1);
for (let below = 0; below <= FLATNESS_RANGE_BYTES; below++) {
  const db = -(below / 255) * (MAX_DECIBELS - MIN_DECIBELS);
  RELATIVE_AMPLITUDE[below] = 10 ** (db / 20);
  RELATIVE_LOG[below] = (db / 20) * Math.LN10;
}

/**
 * Brightness and noisiness of the sound, from the same spectrum as the bands.
 * Centroid is measured on a log-frequency axis: a linear one sits low for nearly all
 * music, while octaves are how brightness is actually heard.
 */
export class SpectralShape {
  /** 0 = dark (cello, sub-bass), 1 = bright (open filter, cymbals). */
  centroid = 0.4;
  /** 0 = pure tones, 1 = noise. */
  flatness = 0.5;

  private readonly position: Float32Array;
  private readonly centroidStart: number;
  private readonly centroidEnd: number;
  private readonly flatStart: number;
  private readonly flatEnd: number;

  constructor(sampleRate: number, fftSize: number) {
    const hzPerBin = sampleRate / fftSize;
    const binCount = fftSize / 2;
    this.centroidStart = Math.max(1, Math.round(CENTROID_LOW_HZ / hzPerBin));
    this.centroidEnd = Math.min(binCount, Math.round(CENTROID_HIGH_HZ / hzPerBin));
    this.flatStart = Math.max(1, Math.round(FLATNESS_LOW_HZ / hzPerBin));
    this.flatEnd = Math.min(binCount, Math.round(FLATNESS_HIGH_HZ / hzPerBin));
    this.position = new Float32Array(binCount);
    const octaves = Math.log2(CENTROID_HIGH_HZ / CENTROID_LOW_HZ);
    for (let bin = 1; bin < binCount; bin++) {
      this.position[bin] = clamp01(Math.log2((bin * hzPerBin) / CENTROID_LOW_HZ) / octaves);
    }
  }

  update(spectrum: Uint8Array, dt: number, active: boolean): void {
    if (!active) return;
    let weighted = 0;
    let total = 0;
    for (let bin = this.centroidStart; bin < this.centroidEnd; bin++) {
      const amplitude = AMPLITUDE[spectrum[bin] ?? 0] ?? 0;
      weighted += amplitude * (this.position[bin] ?? 0);
      total += amplitude;
    }
    if (total > 0) {
      this.centroid += (weighted / total - this.centroid) * (1 - Math.exp(-dt / 0.2));
    }

    let peak = 0;
    for (let bin = this.flatStart; bin < this.flatEnd; bin++) {
      const byte = spectrum[bin] ?? 0;
      if (byte > peak) peak = byte;
    }
    if (peak === 0) return;

    // Measured against the spectrum's own peak: with the analyser's fixed floor, a quiet
    // tone's empty bins and a loud noise's full ones would look alike.
    let logSum = 0;
    let sum = 0;
    const count = this.flatEnd - this.flatStart;
    for (let bin = this.flatStart; bin < this.flatEnd; bin++) {
      const byte = spectrum[bin] ?? 0;
      const below = byte === 0 ? FLATNESS_RANGE_BYTES : Math.min(FLATNESS_RANGE_BYTES, peak - byte);
      logSum += RELATIVE_LOG[below] ?? 0;
      sum += RELATIVE_AMPLITUDE[below] ?? 0;
    }
    const ratio = Math.exp(logSum / count) / (sum / count);
    const flatness = clamp01((ratio - TONE_RATIO) / (NOISE_RATIO - TONE_RATIO));
    this.flatness += (flatness - this.flatness) * (1 - Math.exp(-dt / 0.3));
  }
}

const PITCH_HOLD_S = 0.15;
const CHANGE_THRESHOLD = 0.3;
const CHANGE_REFRACTORY_S = 0.6;

/**
 * Pitch content, for music that has no drums to follow. Reads a separate long-window FFT:
 * at 2048 points a bin is ~23 Hz, wider than a semitone below 400 Hz, so a 2048 spectrum
 * can't tell a piano's C from its C♯. Only spectral peaks count, which keeps noise out.
 */
export class ChromaTracker {
  /** Energy per pitch class (C = 0), normalized so the strongest is 1. */
  readonly chroma = new Float32Array(12);
  /** Dominant pitch class, held steady through brief flickers. */
  pitchClass = 0;
  /** 0 = no clear pitch, 1 = one note or chord dominates. */
  confidence = 0;
  /** Counts harmonic changes (a new chord or note), the tonal counterpart of a beat. */
  changeCount = 0;

  private readonly binPitchClass: Int8Array;
  private readonly start: number;
  private readonly end: number;
  private readonly raw = new Float32Array(12);
  private readonly fast = new Float32Array(12);
  private readonly slow = new Float32Array(12);
  private candidate = 0;
  private candidateHeld = 0;
  private sinceChange = Infinity;

  constructor(sampleRate: number, fftSize: number) {
    const hzPerBin = sampleRate / fftSize;
    this.start = Math.max(2, Math.round(CHROMA_LOW_HZ / hzPerBin));
    this.end = Math.min(fftSize / 2 - 1, Math.round(CHROMA_HIGH_HZ / hzPerBin));
    this.binPitchClass = new Int8Array(fftSize / 2);
    for (let bin = this.start; bin < this.end; bin++) {
      const midi = 69 + 12 * Math.log2((bin * hzPerBin) / 440);
      this.binPitchClass[bin] = ((Math.round(midi) % 12) + 12) % 12;
    }
  }

  update(spectrum: Uint8Array, dt: number, active: boolean): void {
    this.sinceChange += dt;
    if (!active) {
      this.confidence *= Math.exp(-dt / 0.3);
      return;
    }

    const raw = this.raw;
    raw.fill(0);
    for (let bin = this.start; bin < this.end; bin++) {
      const byte = spectrum[bin] ?? 0;
      if (byte > (spectrum[bin - 1] ?? 0) && byte >= (spectrum[bin + 1] ?? 0)) {
        const amplitude = AMPLITUDE[byte] ?? 0;
        const pitch = this.binPitchClass[bin] ?? 0;
        raw[pitch] = (raw[pitch] ?? 0) + amplitude * amplitude;
      }
    }

    let total = 0;
    for (let i = 0; i < 12; i++) total += raw[i] ?? 0;
    if (total <= 0) return;

    const fastMix = 1 - Math.exp(-dt / 0.08);
    const slowMix = 1 - Math.exp(-dt / 1.0);
    let best = 0;
    let bestValue = 0;
    let sum = 0;
    let dot = 0;
    let fastSq = 0;
    let slowSq = 0;
    for (let i = 0; i < 12; i++) {
      const share = (raw[i] ?? 0) / total;
      const f = (this.fast[i] ?? 0) + (share - (this.fast[i] ?? 0)) * fastMix;
      const s = (this.slow[i] ?? 0) + (share - (this.slow[i] ?? 0)) * slowMix;
      this.fast[i] = f;
      this.slow[i] = s;
      dot += f * s;
      fastSq += f * f;
      slowSq += s * s;
      sum += f;
      if (f > bestValue) {
        bestValue = f;
        best = i;
      }
    }

    for (let i = 0; i < 12; i++) this.chroma[i] = (this.fast[i] ?? 0) / Math.max(bestValue, 1e-6);
    this.confidence = clamp01((bestValue - sum / 12) * 2);

    if (best === this.candidate) {
      this.candidateHeld += dt;
      if (this.candidateHeld >= PITCH_HOLD_S) this.pitchClass = best;
    } else {
      this.candidate = best;
      this.candidateHeld = 0;
    }

    // Harmony moved when now no longer resembles the last second.
    const similarity = dot / Math.max(Math.sqrt(fastSq * slowSq), 1e-9);
    if (1 - similarity > CHANGE_THRESHOLD && this.sinceChange > CHANGE_REFRACTORY_S) {
      this.sinceChange = 0;
      this.changeCount++;
    }
  }

  reset(): void {
    this.fast.fill(0);
    this.slow.fill(0);
    this.chroma.fill(0);
    this.confidence = 0;
    this.candidateHeld = 0;
  }
}
