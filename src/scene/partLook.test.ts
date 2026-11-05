import { describe, expect, it, vi } from 'vitest';
import { createAudioFeatures } from '../audio/features';
import { lookOf, PartMemory } from './partLook';

// Dev-only debug hooks in these modules write to window as they load.
vi.hoisted(() => {
  Object.assign(globalThis, { window: {} });
});

describe('Part looks', () => {
  it('keeps the look chosen for the song in its main part', () => {
    expect(lookOf(0).hue).toBe(0);
    expect(lookOf(-1)).toBe(lookOf(0));
  });

  it('gives every part a look of its own', () => {
    const hues = [0, 1, 2, 3, 4].map((part) => lookOf(part).hue);
    expect(new Set(hues).size).toBe(5);
  });

  it('comes back to the same look with the same part', () => {
    const memory = new PartMemory();
    const audio = createAudioFeatures();
    audio.sectionPart = 2;
    for (let i = 0; i < 600; i++) memory.update(1 / 60, audio);
    const first = memory.hue;
    audio.sectionPart = 0;
    for (let i = 0; i < 600; i++) memory.update(1 / 60, audio);
    audio.sectionPart = 2;
    for (let i = 0; i < 600; i++) memory.update(1 / 60, audio);
    expect(memory.hue).toBeCloseTo(first, 3);
  });

  it('lands at once on a drop', () => {
    const memory = new PartMemory();
    const audio = createAudioFeatures();
    audio.sectionPart = 1;
    audio.impact = 1;
    memory.update(1 / 60, audio);
    expect(memory.hue).toBeCloseTo(lookOf(1).hue, 5);
  });

  it('leaves the original version alone', () => {
    const memory = new PartMemory();
    const audio = createAudioFeatures();
    audio.sectionPart = 1;
    audio.living = false;
    for (let i = 0; i < 600; i++) memory.update(1 / 60, audio);
    expect(memory.hue).toBeCloseTo(0, 3);
  });
});
