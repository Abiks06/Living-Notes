import { describe, expect, it } from 'vitest';
import { MoodTracker, VIBES, vibeOf } from './mood';
import { BarTracker, InhaleTracker } from './phrasing';

const DT = 1 / 60;

/** Plays one drum pattern for a number of beats. Slots are beats counted from `offset`. */
function play(
  bars: BarTracker,
  beats: number,
  bpm: number,
  kicks: number[],
  snares: number[],
  offset = 0,
): void {
  const perBeat = Math.round(60 / bpm / DT);
  for (let beat = 0; beat < beats; beat++) {
    for (let frame = 0; frame < perBeat; frame++) {
      const onBeat = frame === 0;
      const slot = (beat - offset + 4000) % 4;
      bars.update(
        beat,
        frame / perBeat,
        bpm,
        true,
        onBeat && kicks.includes(slot),
        onBeat && snares.includes(slot),
      );
    }
  }
}

describe('BarTracker', () => {
  it('finds the 1 from a backbeat, wherever tracking happened to start', () => {
    for (const offset of [0, 1, 2, 3]) {
      const bars = new BarTracker();
      play(bars, 40, 100, [0], [1, 3], offset);
      expect(bars.confidence).toBeGreaterThan(0.5);
      expect(bars.grooveScale).toBe(1);
      bars.update(40 + offset, 0, 100, true, false, false);
      expect(bars.barBeat).toBe(0);
    }
  });

  it('reads a lone snare on 3 at a fast tempo as half-time', () => {
    const bars = new BarTracker();
    play(bars, 40, 140, [0], [2], 1);
    expect(bars.grooveScale).toBe(0.5);
    bars.update(41, 0, 140, true, false, false);
    expect(bars.barBeat).toBe(0);
  });

  it('runs the felt beat at half speed in half-time', () => {
    const bars = new BarTracker();
    play(bars, 40, 140, [0], [2]);
    bars.update(40, 0.5, 140, true, false, false);
    expect(bars.groovePhase).toBeCloseTo(0.25);
    bars.update(41, 0.5, 140, true, false, false);
    expect(bars.groovePhase).toBeCloseTo(0.75);
  });

  it('never calls four-on-the-floor half-time, even if only one clap is heard', () => {
    const bars = new BarTracker();
    play(bars, 40, 124, [0, 1, 2, 3], [1]);
    expect(bars.grooveScale).toBe(1);
  });

  it('never halves an already slow groove', () => {
    const bars = new BarTracker();
    play(bars, 40, 88, [0], [2]);
    expect(bars.grooveScale).toBe(1);
  });

  it('claims nothing without a rhythm to go on', () => {
    const bars = new BarTracker();
    play(bars, 40, 120, [], []);
    expect(bars.confidence).toBe(0);
  });

  it('loses confidence when the tempo lock goes', () => {
    const bars = new BarTracker();
    play(bars, 40, 100, [0], [1, 3]);
    for (let beat = 40; beat < 140; beat++) bars.update(beat, 0, 100, false, false, false);
    expect(bars.confidence).toBeLessThan(0.5);
  });
});

describe('InhaleTracker', () => {
  /** Kicks at these gaps, returning the highest inhale reached. */
  function kicks(breath: InhaleTracker, gaps: number[]): number {
    let peak = 0;
    for (const gap of gaps) {
      for (let t = 0; t < gap; t += DT) {
        breath.update(DT, false, 1);
        peak = Math.max(peak, breath.inhale);
      }
      breath.update(DT, true, 1);
    }
    return peak;
  }

  it('stays still through a regular groove', () => {
    expect(kicks(new InhaleTracker(), Array<number>(30).fill(0.5))).toBeLessThan(0.05);
  });

  it('stays still through uneven syncopation', () => {
    const gaps = Array.from({ length: 40 }, (_, i) => [0.3, 0.4, 0.3, 0.6][i % 4] ?? 0.3);
    expect(kicks(new InhaleTracker(), gaps)).toBeLessThan(0.05);
  });

  it('never reads a sparse groove as a held breath', () => {
    const gaps = Array.from({ length: 30 }, (_, i) => (i % 2 ? 0.55 : 1.2));
    expect(kicks(new InhaleTracker(), [...gaps, 2.4, 1.2, 0.55])).toBeLessThan(0.05);
  });

  it('learns that long gaps are normal after mistaking one for a breath', () => {
    const gaps = Array.from({ length: 30 }, (_, i) => (i < 8 ? 0.5 : i % 2 ? 0.55 : 1.2));
    const breath = new InhaleTracker();
    kicks(breath, gaps);
    expect(kicks(breath, [1.2, 0.55, 1.2, 0.55])).toBeLessThan(0.05);
  });

  it('holds its breath when the next kick goes missing', () => {
    const breath = new InhaleTracker();
    kicks(breath, Array<number>(12).fill(0.5));
    expect(kicks(breath, [1.4])).toBeGreaterThan(0.7);
  });

  it('lets go if no drop comes, as that was a breakdown', () => {
    const breath = new InhaleTracker();
    kicks(breath, Array<number>(12).fill(0.5));
    for (let t = 0; t < 6; t += DT) breath.update(DT, false, 1);
    expect(breath.inhale).toBeLessThan(0.05);
  });

  it('never inhales in silence', () => {
    const breath = new InhaleTracker();
    kicks(breath, Array<number>(12).fill(0.5));
    let peak = 0;
    for (let t = 0; t < 2; t += DT) {
      breath.update(DT, false, 0);
      peak = Math.max(peak, breath.inhale);
    }
    expect(peak).toBeLessThan(0.05);
  });
});

describe('MoodTracker', () => {
  it('names the corners of the compass', () => {
    expect(vibeOf(0.8, 0.7, 0)).toBe('High energy');
    expect(vibeOf(0.8, 0.25, 0)).toBe('Heavy groove');
    expect(vibeOf(0.5, 0.4, 0)).toBe('Warm groove');
    expect(vibeOf(0.5, 0.4, 0.5)).toBe('Melodic drift');
    expect(vibeOf(0.1, 0.4, 0)).toBe('Deep calm');
  });

  it('holds a label instead of flickering between two', () => {
    const mood = new MoodTracker();
    const input = {
      gate: 1,
      intensity: 1,
      centroid: 0.7,
      vocal: 0,
      bpm: 140,
      locked: true,
      onset: false,
    };
    let changes = 0;
    let last = mood.vibe;
    for (let t = 0; t < 30; t += DT) {
      mood.update(DT, { ...input, intensity: Math.sin(t * 6) > 0 ? 1 : 0.5 });
      if (mood.vibe !== last) {
        changes++;
        last = mood.vibe;
      }
    }
    expect(changes).toBeLessThanOrEqual(2);
  });

  it('returns to listening in silence', () => {
    const mood = new MoodTracker();
    const input = {
      gate: 1,
      intensity: 1,
      centroid: 0.7,
      vocal: 0,
      bpm: 140,
      locked: true,
      onset: false,
    };
    for (let t = 0; t < 20; t += DT) mood.update(DT, input);
    expect(VIBES[mood.vibe]).not.toBe('Listening');
    for (let t = 0; t < 5; t += DT) mood.update(DT, { ...input, gate: 0 });
    expect(VIBES[mood.vibe]).toBe('Listening');
  });
});
