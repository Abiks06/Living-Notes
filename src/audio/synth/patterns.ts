import { bass, clap, hat, kick, pad, pluck, type Rig, snare, sub } from './instruments';

export type PatternId = 'pulse' | 'drift' | 'shatter' | 'still';

export interface Pattern {
  readonly bpm: number;
  readonly bars: number;
  schedule(rig: Rig, stepSeconds: number): void;
}

const STEPS = 16;
/** A minor → F → C → G. */
const PROGRESSION = [
  { root: 45, chord: [57, 60, 64, 69] },
  { root: 41, chord: [53, 57, 60, 65] },
  { root: 48, chord: [55, 60, 64, 67] },
  { root: 43, chord: [55, 59, 62, 67] },
] as const;

function eachStep(bars: number, fn: (bar: number, step: number, index: number) => void): void {
  for (let bar = 0; bar < bars; bar++) {
    for (let step = 0; step < STEPS; step++) fn(bar, step, bar * STEPS + step);
  }
}

function chordFor(bar: number) {
  return PROGRESSION[bar % PROGRESSION.length] ?? PROGRESSION[0];
}

/** Driving four-on-the-floor house groove. */
const pulse: Pattern = {
  bpm: 124,
  bars: 8,
  schedule(rig, s) {
    eachStep(this.bars, (bar, step, i) => {
      const t = i * s;
      const { root, chord } = chordFor(bar);
      if (step % 4 === 0) kick(rig, t, 0.95);
      if (step === 4 || step === 12) clap(rig, t);
      if (step % 4 === 2) hat(rig, t, 0.2, true, 0.25);
      else hat(rig, t, step % 2 === 0 ? 0.1 : 0.06, false, -0.2);
      if (step % 4 === 2 || step === 15) bass(rig, t, root + 12, s * 1.6, 0.28);
      if (step === 0) pad(rig, t, chord, s * STEPS, 0.05);
      if (bar >= 4 && step % 3 === 0) pluck(rig, t, (chord[(step / 3) % 4] ?? 69) + 12, 0.05, 0.4);
    });
  },
};

/** Half-time, sub-heavy and spacious. */
const drift: Pattern = {
  bpm: 88,
  bars: 8,
  schedule(rig, s) {
    eachStep(this.bars, (bar, step, i) => {
      const t = i * s;
      const { root, chord } = chordFor(bar);
      if (step === 0 || step === 10) kick(rig, t, 1);
      if (step === 8) snare(rig, t, 0.42);
      if (step % 2 === 0) hat(rig, t, step % 4 === 2 ? 0.09 : 0.05, false, 0.35);
      if (step === 0) {
        sub(rig, t, root - 12, s * STEPS * 0.95, 0.55);
        pad(rig, t, chord, s * STEPS, 0.07);
      }
      const arp = chord[(step + bar) % 4] ?? 69;
      if (step % 2 === 0) pluck(rig, t, arp + 12, 0.045, step % 4 === 0 ? -0.5 : 0.5);
    });
  },
};

/** Broken-beat breaks with a detuned reese bass. */
const shatter: Pattern = {
  bpm: 140,
  bars: 8,
  schedule(rig, s) {
    const kicks = new Set([0, 6, 10]);
    eachStep(this.bars, (bar, step, i) => {
      const t = i * s;
      const { root, chord } = chordFor(bar);
      if (kicks.has(step) || (bar % 2 === 1 && step === 15)) kick(rig, t, 0.95);
      if (step === 4 || step === 12) snare(rig, t, 0.55);
      if (bar % 4 === 3 && step >= 13) snare(rig, t, 0.25);
      hat(rig, t, step % 4 === 2 ? 0.14 : 0.06, step === 14, step % 2 === 0 ? 0.3 : -0.3);
      if (step === 0) bass(rig, t, root, s * 7, 0.22, 14);
      if (step === 8) bass(rig, t, root + (bar % 2 === 0 ? 3 : 7), s * 6, 0.2, 14);
      if (step === 14 && bar % 2 === 1) pad(rig, t, chord, s * 2.5, 0.09);
    });
  },
};

/** No drums and no grid: slow chords and loose notes that swell in the second half. */
const still: Pattern = {
  bpm: 66,
  bars: 8,
  schedule(rig, s) {
    const looseness = [0, 0.11, -0.07, 0.19, 0.05, -0.12, 0.16, -0.03];
    eachStep(this.bars, (bar, step, i) => {
      const t = i * s;
      const { chord } = chordFor(bar);
      const swell = bar < 4 ? 0.3 : 1;
      if (step === 0) pad(rig, t, chord, s * STEPS, 0.05 * swell);
      if (step % 3 === 0) {
        const at = Math.max(0, t + (looseness[i % 8] ?? 0));
        pluck(rig, at, (chord[(step + bar) % 4] ?? 69) + 12, 0.11 * swell, step % 2 ? 0.4 : -0.4);
      }
    });
  },
};

export const PATTERNS: Record<PatternId, Pattern> = { pulse, drift, shatter, still };
