import { describe, expect, it } from 'vitest';
import type { Lane } from './score';
import { groupSections } from './memory';
import { SCORE_RATE } from './sections';
import { CHROMA_RATE, silentVoices, type Voices } from './voices';

const SECTION_S = 10;

/** A song of sections, each drawn from a recipe: which chord, and how much of each part. */
function song(recipes: { pitches: number[]; level: number; held?: number }[]) {
  const frames = recipes.length * SECTION_S * SCORE_RATE;
  const lane = () => new Float32Array(frames);
  const env: Record<Lane, Float32Array> = {
    kick: lane(),
    snare: lane(),
    hat: lane(),
    bass: lane(),
    lead: lane(),
  };
  const sustain = lane();
  const chroma = new Float32Array(recipes.length * SECTION_S * CHROMA_RATE * 12);
  recipes.forEach(({ pitches, level, held = 0 }, section) => {
    const from = section * SECTION_S * SCORE_RATE;
    env.kick.fill(level, from, from + SECTION_S * SCORE_RATE);
    env.bass.fill(level, from, from + SECTION_S * SCORE_RATE);
    sustain.fill(held, from, from + SECTION_S * SCORE_RATE);
    for (let step = 0; step < SECTION_S * CHROMA_RATE; step++) {
      for (const pitch of pitches) {
        chroma[(section * SECTION_S * CHROMA_RATE + step) * 12 + pitch] = 1;
      }
    }
  });
  const voices: Voices = { ...silentVoices(frames), sustain, chroma };
  const starts = Float32Array.from(recipes, (_, i) => i * SECTION_S);
  const sizes = Float32Array.from(recipes, ({ level }) => level);
  return groupSections(starts, sizes, frames, env, voices);
}

const verse = { pitches: [9, 0, 4], level: 0.5 };
const chorus = { pitches: [5, 9, 0], level: 1, held: 0.6 };
const bridge = { pitches: [2, 6, 9], level: 0.2 };

describe('Musical memory', () => {
  it('knows a chorus when it comes back', () => {
    const parts = song([verse, chorus, verse, chorus, bridge, chorus]);
    expect(parts[1]).toBe(parts[3]);
    expect(parts[3]).toBe(parts[5]);
    expect(parts[0]).toBe(parts[2]);
    expect(parts[0]).not.toBe(parts[1]);
    expect(parts[4]).not.toBe(parts[0]);
  });

  it('tells a verse from a chorus on the same chords', () => {
    const parts = song([verse, { ...verse, level: 1 }]);
    expect(parts[0]).not.toBe(parts[1]);
  });

  it('numbers the part the song spends longest in first', () => {
    const parts = song([bridge, chorus, chorus, chorus]);
    expect(parts[1]).toBe(0);
    expect(parts[0]).toBe(1);
  });
});
