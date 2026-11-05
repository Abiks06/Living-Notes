/**
 * Small synthetic songs with known contents, for measuring what the analysis picks out of a
 * finished mix. Every part can be switched on or off, so a test can compare with and without.
 */

export const MIX_RATE = 44100;
export const MIX_BPM = 120;
const BEAT = 60 / MIX_BPM;
export const MIX_BAR = BEAT * 4;
/** Four bars of Am, F, C, G: root, then chord tones. */
const CHORDS = [
  [45, 52, 57, 60, 64],
  [41, 48, 53, 57, 60],
  [48, 55, 60, 64, 67],
  [43, 50, 55, 59, 62],
];
/** Semitones above the root, one per 16th. */
const RIFF = [0, 0, 12, 0, 3, 0, 5, 7, 0, 0, 12, 0, 10, 7, 5, 3];

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const chordAt = (t: number) => CHORDS[Math.floor(t / MIX_BAR) % 4] ?? [45, 52, 57, 60, 64];

function kick(out: Float32Array, time: number): void {
  const start = Math.floor(time * MIX_RATE);
  let phase = 0;
  for (let i = 0; i < MIX_RATE * 0.18 && start + i < out.length; i++) {
    const x = i / MIX_RATE;
    phase += (2 * Math.PI * (50 + 110 * Math.exp(-x * 35))) / MIX_RATE;
    out[start + i] = (out[start + i] ?? 0) + Math.sin(phase) * Math.exp(-x * 16);
  }
}

function snare(out: Float32Array, time: number): void {
  const start = Math.floor(time * MIX_RATE);
  let low = 0;
  for (let i = 0; i < MIX_RATE * 0.16 && start + i < out.length; i++) {
    const x = i / MIX_RATE;
    const noise = Math.random() * 2 - 1;
    low += 0.5 * (noise - low);
    const body = 0.5 * Math.sin(2 * Math.PI * 190 * x) * Math.exp(-x * 30);
    out[start + i] = (out[start + i] ?? 0) + 0.6 * ((noise - low) * Math.exp(-x * 22) + body);
  }
}

function hat(out: Float32Array, time: number, gain: number): void {
  const start = Math.floor(time * MIX_RATE);
  let last = 0;
  for (let i = 0; i < MIX_RATE * 0.04 && start + i < out.length; i++) {
    const noise = Math.random() * 2 - 1;
    out[start + i] =
      (out[start + i] ?? 0) + gain * (noise - last) * Math.exp((-i / MIX_RATE) * 110);
    last = noise;
  }
}

export function drums(out: Float32Array, from: number, to: number, hats = 0.14): void {
  for (let beat = 0; beat * BEAT < to; beat++) {
    const t = beat * BEAT;
    if (t < from) continue;
    kick(out, t);
    if (beat % 2 === 1) snare(out, t);
    hat(out, t, hats);
    hat(out, t + BEAT / 2, hats);
  }
}

export function bass(out: Float32Array, from: number, to: number, gain = 0.35): void {
  const end = Math.min(out.length, to * MIX_RATE);
  for (let i = Math.floor(from * MIX_RATE); i < end; i++) {
    const t = i / MIX_RATE;
    const note = hz((chordAt(t)[0] ?? 45) - 12);
    const pulse = 1 - ((t / (BEAT / 2)) % 1) * 0.6;
    out[i] = (out[i] ?? 0) + gain * pulse * Math.tanh(3 * Math.sin(2 * Math.PI * ((t * note) % 1)));
  }
}

/** A held, filtered saw chord that swells in at the start of each bar. */
export function pad(out: Float32Array, from: number, to: number, gain = 0.1): void {
  let low = 0;
  const end = Math.min(out.length, to * MIX_RATE);
  for (let i = Math.floor(from * MIX_RATE); i < end; i++) {
    const t = i / MIX_RATE;
    const chord = chordAt(t);
    const swell = Math.min(1, ((t / MIX_BAR) % 1) * 3);
    let saw = 0;
    for (let k = 1; k < 5; k++) saw += 2 * ((t * hz(chord[k] ?? 60) * (1 + 0.002 * k)) % 1) - 1;
    low += 0.12 * (saw / 4 - low);
    out[i] = (out[i] ?? 0) + gain * swell * low * 3;
  }
}

/** What the riff plays at each 16th, for checking what the analysis finds. */
export function riffNotes(from: number, to: number): { time: number; midi: number }[] {
  const notes: { time: number; midi: number }[] = [];
  const step = BEAT / 4;
  for (let i = Math.ceil(from / step); i * step < to; i++) {
    const time = i * step;
    notes.push({ time, midi: (chordAt(time)[0] ?? 45) + (RIFF[i % 16] ?? 0) });
  }
  return notes;
}

/** A distorted guitar-like line, or a clean pluck with `drive` near 1. */
export function riff(out: Float32Array, from: number, to: number, gain = 0.22, drive = 9): void {
  let low = 0;
  const end = Math.min(out.length, to * MIX_RATE);
  const step = BEAT / 4;
  for (let i = Math.floor(from * MIX_RATE); i < end; i++) {
    const t = i / MIX_RATE;
    const index = Math.floor(t / step);
    const note = hz((chordAt(t)[0] ?? 45) + (RIFF[index % 16] ?? 0));
    const decay = Math.exp(-((t / step) % 1) * 1.8);
    const saw = 2 * ((t * note) % 1) - 1;
    const fifth = 2 * ((t * note * 1.5) % 1) - 1;
    low += 0.45 * (Math.tanh(drive * decay * (saw + 0.5 * fifth)) - low);
    out[i] = (out[i] ?? 0) + gain * low;
  }
}

export function riser(out: Float32Array, from: number, to: number): void {
  let low = 0;
  for (let i = Math.floor(from * MIX_RATE); i < to * MIX_RATE; i++) {
    const x = (i / MIX_RATE - from) / (to - from);
    low += (0.03 + 0.5 * x * x) * (Math.random() * 2 - 1 - low);
    out[i] = (out[i] ?? 0) + 0.75 * x * low;
  }
}

/** Limits a mix hard, as a modern master does, and wraps it for the analysis. */
export function master(mix: Float32Array): AudioBuffer {
  const buffer = new AudioBuffer({
    length: mix.length,
    sampleRate: MIX_RATE,
    numberOfChannels: 1,
  });
  const out = buffer.getChannelData(0);
  let peak = 1e-6;
  for (let i = 0; i < mix.length; i++) peak = Math.max(peak, Math.abs(mix[i] ?? 0));
  for (let i = 0; i < mix.length; i++) out[i] = Math.tanh(((mix[i] ?? 0) / peak) * 2.2) * 0.9;
  return buffer;
}

export function emptyMix(seconds: number): Float32Array {
  return new Float32Array(Math.floor(seconds * MIX_RATE));
}
