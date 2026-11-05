import { describe, expect, it } from 'vitest';
import { DynamicsTracker } from './dynamics';
import { TEMPO_LOCKED, TempoTracker } from './tempo';

const DT = 1 / 60;
const dbToRms = (db: number) => 10 ** (db / 20);

function hold(tracker: DynamicsTracker, db: number, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) tracker.update(dbToRms(db), DT);
}

describe('DynamicsTracker', () => {
  it('stays shut on digital silence and a file fade tail', () => {
    const d = new DynamicsTracker();
    d.reset(false);
    hold(d, -80, 3);
    expect(d.gate).toBeLessThan(0.01);
  });

  // Found on a real microphone: a stream opens on digital zeros before any room arrives.
  it('is not fooled by the digital silence a microphone opens on', () => {
    const d = new DynamicsTracker();
    d.reset(true);
    for (let t = 0; t < 0.4; t += DT) d.update(0, DT);
    hold(d, -47, 2);
    expect(d.gate).toBeLessThan(0.05);
  });

  // The bench caught this: a clap holding the gate open let room noise fire 9 false beats.
  it('closes again straight after a clap', () => {
    const d = new DynamicsTracker();
    d.reset(true);
    hold(d, -47, 3);
    d.update(dbToRms(-15), DT);
    d.update(dbToRms(-20), DT);
    expect(d.gate).toBeGreaterThan(0.5);
    hold(d, -47, 1.5);
    expect(d.gate).toBeLessThan(0.1);
  });

  it('stays shut while a driver fades the stream in', () => {
    const d = new DynamicsTracker();
    d.reset(true);
    let worst = 0;
    const watch = (db: number, seconds: number) => {
      for (let t = 0; t < seconds; t += DT) {
        d.update(db === -Infinity ? 0 : dbToRms(db), DT);
        worst = Math.max(worst, d.gate);
      }
    };
    watch(-Infinity, 0.2);
    watch(-75, 0.2);
    watch(-60, 0.2);
    watch(-44, 6);
    expect(worst).toBeLessThan(0.05);
  });

  it('hears a clap even before the room has been measured', () => {
    const d = new DynamicsTracker();
    d.reset(true);
    hold(d, -47, 0.5);
    d.update(dbToRms(-15), DT);
    expect(d.gate).toBeGreaterThan(0.5);
  });

  // The spread measured on a laptop mic: mostly ±3 dB, with spikes 7 dB over the median.
  it('stays shut through the frame-to-frame flutter of a real room', () => {
    const d = new DynamicsTracker();
    d.reset(true);
    const flutter = [-44, -47, -42, -45, -41, -46, -44, -43, -47, -37, -45, -42];
    let worst = 0;
    for (let i = 0; i < 60 * 20; i++) {
      d.update(dbToRms(flutter[i % flutter.length] ?? -44), DT);
      if (i > 60) worst = Math.max(worst, d.gate);
    }
    expect(worst).toBeLessThan(0.1);
  });

  it('opens for quiet speech-level sound the transient margin alone would miss', () => {
    const d = new DynamicsTracker();
    d.reset(true);
    hold(d, -50, 2);
    hold(d, -39, 0.6);
    expect(d.gate).toBeGreaterThan(0.5);
  });

  it('still hears a clap straight after a late-starting stream', () => {
    const d = new DynamicsTracker();
    d.reset(true);
    for (let t = 0; t < 1.5; t += DT) d.update(0, DT);
    hold(d, -47, 2);
    d.update(dbToRms(-15), DT);
    expect(d.gate).toBeGreaterThan(0.5);
  });

  it('recovers when the room is loud for its first moments', () => {
    const d = new DynamicsTracker();
    d.reset(true);
    hold(d, -20, 0.5);
    hold(d, -55, 3);
    expect(d.gate).toBeLessThan(0.05);
    d.update(dbToRms(-30), DT);
    expect(d.gate).toBeGreaterThan(0.5);
  });

  it('learns a noisy room on a live input and closes against it', () => {
    const d = new DynamicsTracker();
    d.reset(true);
    hold(d, -50, 8);
    expect(d.gate).toBeLessThan(0.05);
  });

  it('opens on the very first frame of a clap in that room', () => {
    const d = new DynamicsTracker();
    d.reset(true);
    hold(d, -50, 8);
    d.update(dbToRms(-18), DT);
    expect(d.gate).toBeGreaterThan(0.5);
  });

  it('does not let sustained loud music on a live input gate itself', () => {
    const d = new DynamicsTracker();
    d.reset(true);
    hold(d, -20, 60);
    expect(d.gate).toBeGreaterThan(0.95);
  });

  it('remembers the chorus through a quiet verse', () => {
    const d = new DynamicsTracker();
    d.reset(false);
    hold(d, -12, 10);
    expect(d.intensity).toBeGreaterThan(0.95);
    hold(d, -24, 8);
    expect(d.intensity).toBeLessThan(0.6);
  });

  it('leaves a quiet opening somewhere to grow from', () => {
    const d = new DynamicsTracker();
    d.reset(false);
    hold(d, -40, 20);
    const quiet = d.intensity;
    hold(d, -12, 2);
    expect(quiet).toBeLessThan(0.5);
    expect(d.intensity).toBeGreaterThan(0.95);
  });
});

function feed(tracker: TempoTracker, seconds: number, onset: (time: number) => number): void {
  for (let t = 0; t < seconds; t += DT) tracker.update(onset(t), DT);
}

const pulses = (bpm: number) => {
  const period = 60 / bpm;
  return (t: number) => (t % period < DT ? 1 : 0.02);
};

describe('TempoTracker', () => {
  // Phase corrections that cross the beat used to count it twice, or not at all.
  it('counts each beat once while phase corrections wander across the beat', () => {
    const tracker = new TempoTracker();
    const beat = 0.5;
    let nextHit = 0;
    let hit = 0;
    let previous = 0;
    let lastBeatAt = 0;
    let shortest = Infinity;
    let longest = 0;
    for (let t = 0; t < 40; t += DT) {
      let flux = 0;
      if (t >= nextHit) {
        flux = 1;
        hit++;
        // Played by a human: early and late by turns, right around the beat itself.
        nextHit = hit * beat + 0.05 * Math.sin(hit * 2.4);
      }
      tracker.update(flux, DT);
      if (tracker.beatIndex !== previous) {
        if (t > 10) {
          shortest = Math.min(shortest, t - lastBeatAt);
          longest = Math.max(longest, t - lastBeatAt);
        }
        lastBeatAt = t;
      }
      previous = tracker.beatIndex;
      expect(tracker.phase).toBeGreaterThanOrEqual(0);
      expect(tracker.phase).toBeLessThan(1);
    }
    // A double count shows up as two beats almost together, a skip as a long gap. They cancel
    // in a total, so it's the spacing that has to be checked.
    expect(shortest).toBeGreaterThan(beat * 0.6);
    expect(longest).toBeLessThan(beat * 1.5);
  });

  it.each([80, 100, 124, 140, 170])('locks onto %i BPM', (bpm) => {
    const tempo = new TempoTracker();
    feed(tempo, 12, pulses(bpm));
    expect(Math.abs(tempo.bpm - bpm)).toBeLessThan(1.5);
    expect(tempo.confidence).toBeGreaterThan(TEMPO_LOCKED);
  });

  it('tracks a tempo change', () => {
    const tempo = new TempoTracker();
    feed(tempo, 10, pulses(100));
    feed(tempo, 12, pulses(130));
    expect(Math.abs(tempo.bpm - 130)).toBeLessThan(2);
  });

  it('puts the phase on the beat', () => {
    const tempo = new TempoTracker();
    const onset = pulses(120);
    let t = 0;
    for (; t < 12; t += DT) tempo.update(onset(t), DT);
    while (onset(t) < 1) {
      tempo.update(onset(t), DT);
      t += DT;
    }
    const distance = Math.min(tempo.phase, 1 - tempo.phase);
    expect(distance).toBeLessThan(0.12);
  });

  it('admits it has no pulse in free-time onsets', () => {
    const tempo = new TempoTracker();
    let seed = 7;
    let next = 0.4;
    feed(tempo, 14, (t) => {
      if (t < next) return 0.02;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      next = t + 0.4 + (seed / 0x7fffffff) * 1.6;
      return 1;
    });
    expect(tempo.confidence).toBeLessThan(TEMPO_LOCKED);
  });
});
