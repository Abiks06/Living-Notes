import { describe, expect, it } from 'vitest';
import { trailDamping } from './trailDamping';

const DT = 1 / 60;

function run(start: number, speed: number, seconds: number): number {
  let value = start;
  for (let t = 0; t < seconds; t += DT) value = trailDamping(value, speed, DT);
  return value;
}

describe('trailDamping', () => {
  it('leaves trails alone at auto-orbit speed', () => {
    expect(run(0, 0.11, 5)).toBe(0);
  });

  it('removes trails within a few frames of a fast drag', () => {
    expect(run(0, 1.5, 0.1)).toBeGreaterThan(0.8);
  });

  it('restores them gradually after the camera settles', () => {
    expect(run(1, 0, 0.1)).toBeGreaterThan(0.7);
    expect(run(1, 0, 2)).toBeLessThan(0.02);
  });

  it('is frame-rate independent', () => {
    let at60 = 1;
    let at144 = 1;
    for (let i = 0; i < 30; i++) at60 = trailDamping(at60, 0, 1 / 60);
    for (let i = 0; i < 72; i++) at144 = trailDamping(at144, 0, 1 / 144);
    expect(at60).toBeCloseTo(at144, 5);
  });
});
