import { describe, expect, it } from 'vitest';
import { SongClock } from './songClock';

describe('SongClock', () => {
  it('passes a single report straight through', () => {
    expect(new SongClock().report(42, 100_000, true)).toBeCloseTo(42, 5);
  });

  it('steadies reports that land early and late', () => {
    const clock = new SongClock();
    // The spread read from a real Chrome session: up to 0.3 s out, differently each time.
    const errors = [0.05, 0.3, -0.06, 0.04, 0.03, 0.13, 0.14, 0.23, -0.05, 0.02];
    const steadied: number[] = [];
    errors.forEach((error, i) => {
      const at = 100_000 + i * 750;
      steadied.push(clock.report(10 + i * 0.75 + error, at, true) - (10 + i * 0.75));
    });
    const settled = steadied.slice(4);
    expect(Math.max(...settled) - Math.min(...settled)).toBeLessThan(0.1);
    expect(Math.max(...errors) - Math.min(...errors)).toBeGreaterThan(0.3);
  });

  it('follows a seek at once', () => {
    const clock = new SongClock();
    for (let i = 0; i < 6; i++) clock.report(10 + i, 100_000 + i * 1000, true);
    expect(clock.report(95, 106_000, true)).toBeCloseTo(95, 5);
  });

  it('starts again after a pause', () => {
    const clock = new SongClock();
    for (let i = 0; i < 6; i++) clock.report(10 + i, 100_000 + i * 1000, true);
    clock.report(15, 106_000, false);
    // Thirty seconds paused: carrying the old start forward would put the song 30 s ahead.
    expect(clock.report(15.2, 136_000, true)).toBeCloseTo(15.2, 5);
  });
});
