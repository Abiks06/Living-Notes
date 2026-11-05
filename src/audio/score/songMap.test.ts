import { describe, expect, it, vi } from 'vitest';
import { createAudioFeatures } from '../features';
import { readCast, soloActor } from '../cast';
import { buildScore, type LaneAudio } from './score';
import { sectionAt, summarise } from './songMap';

// Dev-only debug hooks in these modules write to window as they load.
vi.hoisted(() => {
  Object.assign(globalThis, { window: {} });
});

const RATE = 8000;

function clicks(seconds: number, from: number, to: number, step: number, peak = 0.8) {
  const out = new Float32Array(seconds * RATE);
  for (let t = from; t < to; t += step) {
    const start = Math.floor(t * RATE);
    for (let i = 0; i < RATE * 0.05; i++) {
      out[start + i] = peak * Math.exp(-i / (RATE * 0.012)) * (i % 2 ? 1 : -1);
    }
  }
  return out;
}

function song(): LaneAudio {
  const seconds = 40;
  const kick = clicks(seconds, 0.5, 18, 1);
  kick.set(clicks(seconds, 20, 38, 0.5).subarray(20 * RATE), 20 * RATE);
  const snare = clicks(seconds, 1, 18, 1, 0.7);
  snare.set(clicks(seconds, 20.5, 38, 1, 0.7).subarray(20 * RATE), 20 * RATE);
  return {
    kick,
    snare,
    hat: clicks(seconds, 0.25, 38, 0.25, 0.3),
    bass: clicks(seconds, 20, 38, 0.5, 0.9),
    lead: new Float32Array(seconds * RATE),
  };
}

describe('Song map', () => {
  const summary = summarise(buildScore(song(), RATE, true));

  it('names the drop and the climb into it', () => {
    expect(sectionAt(summary, 25)?.kind).toBe('Drop');
    expect(sectionAt(summary, 19)?.kind).toBe('Climb');
  });

  it('covers the whole song with no gaps', () => {
    expect(summary.sections[0]?.start).toBe(0);
    expect(summary.sections.at(-1)?.end).toBe(summary.duration);
    summary.sections.slice(1).forEach((section, i) => {
      expect(section.start).toBe(summary.sections[i]?.end);
    });
  });

  it('marks the drop for the strip', () => {
    expect(summary.drops.length).toBe(1);
    expect(summary.lanes.hits.some((level) => level > 0)).toBe(true);
  });

  it('knows which parts it found', () => {
    expect(summary.heard.drums).toBe(true);
    expect(summary.heard.pads).toBe(false);
  });
});

describe('Cast', () => {
  const playing = () => {
    const audio = createAudioFeatures();
    audio.kick = 1;
    audio.sustain = 0.8;
    audio.noteHit = 0.9;
    audio.vocal = 0.7;
    audio.bands.fill(0.5);
    return audio;
  };

  it('reads each part’s activity', () => {
    const levels = new Float32Array(5);
    readCast(playing(), levels);
    expect([...levels].every((level) => level > 0)).toBe(true);
  });

  it('leaves only the soloed part driving the picture', () => {
    const audio = playing();
    soloActor(audio, 'pads');
    expect(audio.sustain).toBeCloseTo(0.8);
    expect(audio.kick).toBe(0);
    expect(audio.noteHit).toBe(0);
    expect(audio.vocal).toBe(0);
    expect(audio.bands[0]).toBe(0);
  });

  it('keeps the drums’ own bands when they’re soloed', () => {
    const audio = playing();
    soloActor(audio, 'drums');
    expect(audio.kick).toBe(1);
    expect(audio.bands[4]).toBeCloseTo(0.5);
    expect(audio.sustain).toBe(0);
  });
});
