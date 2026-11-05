import { describe, expect, it, vi } from 'vitest';
import { createAudioFeatures } from '../features';
import {
  buildScore,
  envelope,
  findMelody,
  findTempo,
  followBeats,
  type LaneAudio,
  pickHits,
  smoothMelody,
  SCORE_RATE,
} from './score';
import { LIGHT_LEAD_S, MOTION_LEAD_S, ScorePlayer } from './scorePlayer';

// Dev-only debug hooks in these modules write to window as they load.
vi.hoisted(() => {
  Object.assign(globalThis, { window: {} });
});

const RATE = 8000;

/** A click track on a lane: short decaying bursts at the given times. */
function clicks(seconds: number, times: number[], peak = 0.8): Float32Array {
  const out = new Float32Array(seconds * RATE);
  for (const time of times) {
    const start = Math.floor(time * RATE);
    for (let i = 0; i < RATE * 0.05; i++) {
      out[start + i] = peak * Math.exp(-i / (RATE * 0.012)) * (i % 2 ? 1 : -1);
    }
  }
  return out;
}

const every = (from: number, to: number, step: number) => {
  const times: number[] = [];
  for (let t = from; t < to; t += step) times.push(t);
  return times;
};

/** A groove at 120 BPM that goes quiet for a while, then comes back bigger. */
function song(): LaneAudio {
  const seconds = 40;
  const beat = 0.5;
  const verse = every(0.5, 18, beat * 2);
  const drop = every(20, 38, beat);
  return {
    kick: clicks(seconds, [...verse, ...drop]),
    snare: clicks(seconds, [...every(1, 18, beat * 2), ...every(20.5, 38, beat * 2)], 0.7),
    hat: clicks(seconds, every(0.25, 38, 0.25), 0.3),
    bass: clicks(seconds, drop, 0.9),
    lead: new Float32Array(seconds * RATE),
  };
}

describe('Score analysis', () => {
  it('measures a level at the score’s frame rate', () => {
    const env = envelope(clicks(2, [1]), RATE);
    expect(env.length).toBe(2 * SCORE_RATE);
    expect(env[SCORE_RATE + 1]).toBeGreaterThan(0.5);
    expect(env[50]).toBe(0);
  });

  it('finds each hit, close to when it happened', () => {
    const times = [0.5, 1, 1.5, 2];
    const hits = pickHits(envelope(clicks(3, times), RATE), 0.12);
    expect(hits.length).toBe(times.length);
    hits.forEach((hit, i) => expect(Math.abs(hit - (times[i] ?? 0))).toBeLessThan(0.03));
  });

  it('finds a steady tempo and where its beats fall', () => {
    const strength = new Float32Array(30 * SCORE_RATE);
    for (let t = 0.3; t < 30; t += 0.5) strength[Math.round(t * SCORE_RATE)] = 1;
    const tempo = findTempo(strength);
    expect(tempo.bpm).toBeCloseTo(120, 0);
    expect(tempo.offset % 0.5).toBeCloseTo(0.3, 1);
    expect(tempo.confidence).toBeGreaterThan(0.5);
  });

  it('trusts the backbeat over a busy pattern', () => {
    const strength = new Float32Array(60 * SCORE_RATE);
    // At 133 BPM, with hits every third 8th that look like a slower pulse of 89.
    const beat = 60 / 133;
    for (let t = 0; t < 60; t += beat * 1.5) strength[Math.round(t * SCORE_RATE)] = 1;
    const snares = Float32Array.from({ length: 60 }, (_, i) => beat + i * beat * 2);
    expect(findTempo(strength, snares).bpm).toBeCloseTo(133, 0);
  });

  it('stays on the beat to the end of a long song', () => {
    const seconds = 300;
    const strength = new Float32Array(seconds * SCORE_RATE);
    const beat = 60 / 97.3;
    for (let t = 0.2; t < seconds; t += beat) strength[Math.round(t * SCORE_RATE)] = 1;
    const tempo = findTempo(strength);
    const period = 60 / tempo.bpm;
    const beats = Math.round((seconds - 2 - tempo.offset) / period);
    const last = 0.2 + Math.floor((seconds - 2 - 0.2) / beat) * beat;
    const drift = Math.abs(((last - tempo.offset + period / 2) % period) - period / 2);
    expect(beats).toBeGreaterThan(400);
    expect(drift).toBeLessThan(0.02);
  });

  it('takes a steady kick as the beat, not half of it', () => {
    const strength = new Float32Array(60 * SCORE_RATE);
    const beat = 60 / 129;
    const kicks = Float32Array.from({ length: 120 }, (_, i) => 0.1 + i * beat);
    // Accents every other beat are what make four-on-the-floor read as half speed.
    for (let t = 0.1; t < 55; t += beat * 2) strength[Math.round(t * SCORE_RATE)] = 1;
    expect(findTempo(strength, undefined, undefined, kicks).bpm).toBeCloseTo(129, 0);
  });

  it('follows a drummer who speeds up', () => {
    const hits = new Float32Array(60 * SCORE_RATE);
    const played: number[] = [];
    let t = 0.5;
    while (t < 58) {
      played.push(t);
      hits[Math.round(t * SCORE_RATE)] = 1;
      t += 0.44 - t * 0.001;
    }
    const beats = followBeats(hits, 0.415);
    const near = played.filter((time) => [...beats].some((b) => Math.abs(b - time) < 0.03));
    expect(near.length / played.length).toBeGreaterThan(0.9);
  });

  it('says so when hits don’t keep time', () => {
    const strength = new Float32Array(60 * SCORE_RATE);
    let t = 0;
    let seed = 7;
    while (t < 60) {
      strength[Math.round(t * SCORE_RATE)] = 1;
      seed = (seed * 16807) % 2147483647;
      t += 0.3 + (seed / 2147483647) * 0.9;
    }
    expect(findTempo(strength).confidence).toBeLessThan(0.4);
  });

  it('claims no tempo in silence', () => {
    expect(findTempo(new Float32Array(1000)).confidence).toBe(0);
  });

  it('reads the melody’s notes', () => {
    const rate = 22050;
    const samples = new Float32Array(rate * 2);
    for (let i = 0; i < samples.length; i++) {
      const hz = i < rate ? 440 : 660;
      samples[i] = Math.sin((i / rate) * Math.PI * 2 * hz) * 0.5;
    }
    const melody = findMelody(samples, rate, 2);
    expect(melody[50]).toBeCloseTo(69, 0);
    expect(melody[150]).toBeCloseTo(76, 0);
  });

  it('folds octave slips back into the melody', () => {
    const hold = 5;
    const notes = new Float32Array(100).fill(69);
    for (let i = 20; i < 25; i++) notes[i] = 81;
    for (let i = 50; i < 55; i++) notes[i] = 57;
    expect([...smoothMelody(notes, hold)].every((note) => Math.abs(note - 69) < 0.5)).toBe(true);
  });

  it('lets a real step in the tune through', () => {
    const notes = new Float32Array(100).fill(69);
    notes.fill(72, 50);
    const melody = smoothMelody(notes, 5);
    expect(melody[20]).toBe(69);
    expect(melody[80]).toBe(72);
  });

  it('knows a song’s biggest moments against its own range', () => {
    const score = buildScore(song(), RATE, true);
    expect(score.presence[10 * SCORE_RATE]).toBeLessThan(score.presence[30 * SCORE_RATE] ?? 0);
    expect(score.presence[30 * SCORE_RATE]).toBeGreaterThan(0.7);
  });

  it('finds the drop, on the kick that starts it', () => {
    const score = buildScore(song(), RATE, true);
    expect(score.drops.length).toBe(1);
    expect(Math.abs((score.drops[0] ?? 0) - 20)).toBeLessThan(0.05);
  });

  it('finds no drop in a song that never changes', () => {
    const seconds = 40;
    const steady: LaneAudio = {
      kick: clicks(seconds, every(0, 39, 0.5)),
      snare: clicks(seconds, every(0.5, 39, 1), 0.7),
      hat: clicks(seconds, every(0, 39, 0.25), 0.3),
      bass: clicks(seconds, every(0, 39, 0.5), 0.9),
      lead: new Float32Array(seconds * RATE),
    };
    const score = buildScore(steady, RATE, true);
    expect(score.drops.length).toBe(0);
    expect(new Set(score.presence.slice(400, 3600)).size).toBe(1);
  });

  it('doesn’t slam a swell, however big it gets', () => {
    const seconds = 40;
    const swell = new Float32Array(seconds * RATE);
    for (let i = 0; i < swell.length; i++) {
      const t = i / RATE;
      const size = t < 20 ? 0.12 : Math.min(0.8, 0.12 + (t - 20) * 0.34);
      swell[i] = size * Math.sin(t * Math.PI * 2 * 90);
    }
    const score = buildScore(
      {
        kick: swell,
        bass: swell,
        snare: new Float32Array(seconds * RATE),
        hat: new Float32Array(seconds * RATE),
        lead: swell,
      },
      RATE,
      true,
    );
    expect(score.drops.length).toBe(0);
  });

  it('doesn’t take the song starting for a drop', () => {
    const score = buildScore(song(), RATE, true);
    expect(score.drops.every((drop) => drop > 4)).toBe(true);
  });
});

describe('ScorePlayer', () => {
  const score = buildScore(song(), RATE, true);

  it('fires a kick at the moment it happens, with nothing to wait for', () => {
    const player = new ScorePlayer();
    const out = createAudioFeatures();
    const hit = score.hits.kick[3] ?? 0;
    player.apply(score, hit - LIGHT_LEAD_S - 0.02, out);
    const before = out.kick;
    player.apply(score, hit - LIGHT_LEAD_S + 0.001, out);
    expect(out.kick).toBeGreaterThan(0.9);
    expect(before).toBeLessThan(out.kick);
  });

  it('knows the beat from the very first second', () => {
    const player = new ScorePlayer();
    const out = createAudioFeatures();
    player.apply(score, 1, out);
    expect(out.bpm).toBeCloseTo(120, 0);
    expect(out.tempoConfidence).toBeGreaterThan(0.55);
  });

  it('draws breath before the drop, while the drop is still to come', () => {
    const player = new ScorePlayer();
    const out = createAudioFeatures();
    const drop = score.drops[0] ?? 0;
    player.apply(score, drop - LIGHT_LEAD_S - 0.3, out);
    expect(out.inhale).toBeGreaterThan(0.5);
    player.apply(score, drop - LIGHT_LEAD_S + 0.01, out);
    expect(out.inhale).toBe(0);
    expect(out.impact).toBeGreaterThan(0.9);
  });

  it('never lets a drop land before the sound', () => {
    const player = new ScorePlayer();
    const out = createAudioFeatures();
    player.apply(score, (score.drops[0] ?? 0) - MOTION_LEAD_S, out);
    expect(out.impact).toBe(0);
  });

  it('knows which part of the song it’s in', () => {
    const player = new ScorePlayer();
    const out = createAudioFeatures();
    player.apply(score, 5, out);
    const verse = out.sectionPart;
    player.apply(score, 25, out);
    expect(verse).toBeGreaterThanOrEqual(0);
    expect(out.sectionPart).not.toBe(verse);
  });

  it('climbs into a drop at any tempo', () => {
    const seconds = 40;
    const beat = 60 / 127;
    const land = beat * 40;
    const verse = every(beat, land - beat * 4, beat * 2);
    const big = every(land, 38, beat);
    const score = buildScore(
      {
        kick: clicks(seconds, [...verse, ...big]),
        snare: clicks(seconds, every(beat * 2, 38, beat * 2), 0.7),
        hat: clicks(seconds, every(beat / 2, 38, beat / 2), 0.3),
        bass: clicks(seconds, big, 0.9),
        lead: new Float32Array(seconds * RATE),
      },
      RATE,
      true,
    );
    const drop = Math.round((score.drops[0] ?? 0) * SCORE_RATE);
    expect(drop).toBeGreaterThan(0);
    expect(score.tension[drop - 20]).toBeGreaterThan(0.3);
  });

  it('stops time just before the drop, and only then', () => {
    const player = new ScorePlayer();
    const out = createAudioFeatures();
    const drop = score.drops[0] ?? 0;
    player.apply(score, drop - 0.1, out);
    expect(out.hang).toBeGreaterThan(0.5);
    out.hang = 0;
    player.apply(score, drop - 0.6, out);
    expect(out.hang).toBe(0);
  });

  it('holds the quiet right up to the drop, then opens at once', () => {
    const player = new ScorePlayer();
    const out = createAudioFeatures();
    const drop = score.drops[0] ?? 0;
    player.apply(score, drop - 0.2, out);
    const before = out.presence;
    expect(out.tension).toBeGreaterThan(0.5);
    player.apply(score, drop + 0.05, out);
    expect(before).toBeLessThan(0.4);
    expect(out.presence).toBeGreaterThan(0.7);
    expect(out.tension).toBe(0);
    expect(out.world).toBeGreaterThan(0.5);
  });

  it('leaves the live breath alone when the score found no drops', () => {
    const player = new ScorePlayer();
    const out = createAudioFeatures();
    out.inhale = 0.8;
    player.apply({ ...score, drops: new Float32Array(0) }, 5, out);
    expect(out.inhale).toBe(0.8);
  });

  it('keeps counting forward through a loop', () => {
    const player = new ScorePlayer();
    const out = createAudioFeatures();
    player.apply(score, 35, out);
    const before = out.beatIndex;
    player.apply(score, 0.6, out);
    expect(out.beatIndex).toBeGreaterThan(before);
  });

  it('counts snares crossed between frames', () => {
    const player = new ScorePlayer();
    const out = createAudioFeatures();
    player.apply(score, 0.5, out);
    const before = out.snareCount;
    player.apply(score, 3.2, out);
    expect(out.snareCount).toBeGreaterThan(before);
  });

  it('starts motion well before the hit, but light only just', () => {
    const player = new ScorePlayer();
    const out = createAudioFeatures();
    const hit = score.hits.kick[3] ?? 0;
    player.apply(score, hit - 0.15, out);
    expect(out.push).toBeGreaterThan(0.2);
    expect(out.kick).toBeLessThan(out.push);
  });

  it('never leads light by more than people forgive', () => {
    expect(LIGHT_LEAD_S).toBeLessThan(0.1);
  });
});
