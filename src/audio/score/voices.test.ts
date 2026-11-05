import { describe, expect, it } from 'vitest';
import { SCORE_RATE } from './sections';
import { readVoices, VOICE_SAMPLE_RATE } from './voices';

const RATE = VOICE_SAMPLE_RATE;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** A rich held tone per note, as a pad's are. */
function held(out: Float32Array, notes: number[], from: number, to: number, gain = 0.1): void {
  for (let i = Math.floor(from * RATE); i < to * RATE; i++) {
    for (const note of notes) {
      for (let h = 1; h <= 4; h++) {
        out[i] = (out[i] ?? 0) + (gain / h) * Math.sin((i / RATE) * 2 * Math.PI * hz(note) * h);
      }
    }
  }
}

/** A struck, decaying note. */
function pluck(out: Float32Array, note: number, time: number, gain = 0.5): void {
  const start = Math.floor(time * RATE);
  for (let i = 0; i < RATE * 0.22 && start + i < out.length; i++) {
    let tone = 0;
    for (let h = 1; h <= 5; h++) tone += Math.sin((i / RATE) * 2 * Math.PI * hz(note) * h) / h;
    out[start + i] = (out[start + i] ?? 0) + gain * tone * Math.exp((-i / RATE) * 12);
  }
}

/** A hard broadband click, as a drum is to a spectrum. */
function hit(out: Float32Array, time: number): void {
  const start = Math.floor(time * RATE);
  for (let i = 0; i < RATE * 0.03; i++) {
    out[start + i] = (out[start + i] ?? 0) + (Math.random() * 2 - 1) * Math.exp((-i / RATE) * 150);
  }
}

const mean = (lane: Float32Array, from: number, to: number) => {
  let sum = 0;
  for (let i = from * SCORE_RATE; i < to * SCORE_RATE; i++) sum += lane[i] ?? 0;
  return sum / ((to - from) * SCORE_RATE);
};

describe('Reading voices from a mix', () => {
  it('hears a held chord as held, with no notes in it', () => {
    const song = new Float32Array(RATE * 8);
    held(song, [64, 67, 72], 0, 8);
    for (let t = 0; t < 8; t += 0.5) hit(song, t);
    const voices = readVoices(song, RATE);
    expect(mean(voices.sustain, 2, 6)).toBeGreaterThan(0.5);
    expect(voices.noteTimes.length).toBeLessThan(6);
  });

  it('hears a riff as notes, each at its own pitch', () => {
    const song = new Float32Array(RATE * 8);
    const riff = [64, 67, 69, 71, 72, 71, 69, 67];
    for (let i = 0; i < 24; i++) pluck(song, riff[i % 8] ?? 64, 1 + i * 0.25);
    const voices = readVoices(song, RATE);
    expect(voices.noteTimes.length).toBeGreaterThan(14);
    let right = 0;
    voices.noteTimes.forEach((time, n) => {
      const step = Math.round((time - 1) / 0.25);
      if (voices.notePitches[n] === riff[step % 8]) right++;
    });
    expect(right / voices.noteTimes.length).toBeGreaterThan(0.75);
    expect(mean(voices.sustain, 2, 6)).toBeLessThan(0.3);
  });

  it('tells a centred voice from a wide riff', () => {
    const middle = new Float32Array(RATE * 8);
    const sides = new Float32Array(RATE * 8);
    const riff = [64, 67, 69, 71];
    for (let i = 0; i < 12; i++) {
      pluck(middle, riff[i % 4] ?? 64, 1 + i * 0.5);
      pluck(sides, riff[i % 4] ?? 64, 1 + i * 0.5);
    }
    const wide = readVoices(middle, RATE, sides);
    expect(wide.hasVoice).toBe(true);
    expect(wide.noteTimes.length).toBeGreaterThan(6);

    const centred = new Float32Array(RATE * 8);
    for (let i = 0; i < 12; i++) pluck(centred, riff[i % 4] ?? 64, 1 + i * 0.5);
    // A little ambience in the sides, so the mix counts as stereo at all.
    const ambience = Float32Array.from(centred, (_, i) => Math.sin(i * 0.31) * 0.12);
    const voice = readVoices(centred, RATE, ambience);
    expect(voice.noteTimes.length).toBeLessThan(wide.noteTimes.length);
    expect(mean(voice.voice, 1, 7)).toBeGreaterThan(mean(wide.voice, 1, 7));
  });

  it('leaves a mono mix as all notes', () => {
    const song = new Float32Array(RATE * 8);
    for (let i = 0; i < 12; i++) pluck(song, 64, 1 + i * 0.5);
    const voices = readVoices(song, RATE, new Float32Array(RATE * 8));
    expect(voices.hasVoice).toBe(false);
    expect(voices.noteTimes.length).toBeGreaterThan(6);
  });

  it('follows a tune as one line, without slipping to its harmonics', () => {
    const song = new Float32Array(RATE * 10);
    const tune = [64, 67, 69, 72, 71, 69, 67, 64];
    tune.forEach((note, i) => held(song, [note], 1 + i, 2 + i, 0.25));
    const { line } = readVoices(song, RATE, undefined);
    let right = 0;
    let sung = 0;
    for (let t = 1.2; t < 8.8; t += 0.1) {
      const note = line[Math.round(t * SCORE_RATE)] ?? 0;
      if (note <= 0) continue;
      sung++;
      if (Math.abs(note - (tune[Math.floor(t - 1)] ?? 0)) < 0.6) right++;
    }
    expect(right / Math.max(1, sung)).toBeGreaterThan(0.7);
  });

  it('hears nothing in drums alone', () => {
    const song = new Float32Array(RATE * 8);
    for (let t = 0; t < 8; t += 0.25) hit(song, t);
    const voices = readVoices(song, RATE);
    expect(mean(voices.sustain, 1, 7)).toBeLessThan(0.1);
    expect(voices.noteTimes.length).toBeLessThan(4);
  });

  it('finds where the chord changes', () => {
    const song = new Float32Array(RATE * 12);
    held(song, [57, 60, 64], 0, 4);
    held(song, [53, 57, 60], 4, 8);
    held(song, [55, 59, 62], 8, 12);
    const voices = readVoices(song, RATE);
    const near = (time: number) => [...voices.chordTimes].some((t) => Math.abs(t - time) < 0.4);
    expect(near(4)).toBe(true);
    expect(near(8)).toBe(true);
    expect(voices.chordTimes.length).toBeLessThan(5);
  });
});
