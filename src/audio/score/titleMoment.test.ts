import { describe, expect, it } from 'vitest';
import { SCORE_RATE } from './sections';
import { titleMoment } from './titleMoment';

/** A song as a list of [start in seconds, fullness] sections. */
function song(sections: readonly (readonly [number, number])[], duration: number) {
  const presence = new Float32Array(duration * SCORE_RATE);
  sections.forEach(([start, level], i) => {
    const end = sections[i + 1]?.[0] ?? duration;
    presence.fill(level, start * SCORE_RATE, end * SCORE_RATE);
  });
  return {
    drops: new Float32Array(0),
    sectionStarts: Float32Array.from(sections.map(([start]) => start)),
    presence,
    duration,
  };
}

describe('titleMoment', () => {
  it('uses the first drop when there is one', () => {
    const shape = { ...song([[0, 0.2]], 100), drops: Float32Array.of(42, 80) };
    expect(titleMoment(shape)).toBe(42);
  });

  it('finds the first chorus of a song with no drops', () => {
    const sections = [
      [0, 0.2],
      [24, 0.4],
      [62, 0.9],
      [100, 0.4],
      [140, 0.9],
    ] as const;
    expect(titleMoment(song(sections, 200))).toBe(62);
  });

  it('settles for the biggest change when nothing is clearly a chorus', () => {
    const sections = [
      [0, 0.1],
      [30, 0.2],
      [70, 0.45],
      [120, 0.4],
    ] as const;
    expect(titleMoment(song(sections, 160))).toBe(70);
  });

  it('ignores a change right at the start', () => {
    const sections = [
      [0, 0.1],
      [4, 0.9],
      [60, 0.2],
    ] as const;
    expect(titleMoment(song(sections, 200))).toBe(50);
  });

  it('still lands somewhere in a song that never changes', () => {
    expect(titleMoment(song([[0, 0.5]], 200))).toBe(50);
  });
});
