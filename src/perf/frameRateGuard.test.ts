import { describe, expect, it } from 'vitest';
import { COOLDOWN_S, FrameRateGuard } from './frameRateGuard';
import { LOW_FPS } from './qualityLadder';

function run(guard: FrameRateGuard, fps: number, seconds: number): boolean {
  let fired = false;
  for (let t = 0; t < seconds; t += 1 / fps) {
    const measured = guard.push(1 / fps);
    fired = (measured !== null && measured < LOW_FPS) || fired;
  }
  return fired;
}

describe('FrameRateGuard', () => {
  it('ignores the warm-up cooldown', () => {
    expect(run(new FrameRateGuard(), 20, COOLDOWN_S - 0.5)).toBe(false);
  });

  it('fires after a sustained 3 s window under 45 FPS', () => {
    const guard = new FrameRateGuard();
    run(guard, 60, COOLDOWN_S);
    expect(run(guard, 30, 3.2)).toBe(true);
  });

  it('reports the average of each full window', () => {
    const guard = new FrameRateGuard();
    run(guard, 60, COOLDOWN_S);
    let measured: number | null = null;
    for (let t = 0; t < 3.2 && measured === null; t += 1 / 50) measured = guard.push(1 / 50);
    expect(measured).toBeCloseTo(50, 3);
  });

  it('stays quiet at a healthy frame rate', () => {
    const guard = new FrameRateGuard();
    run(guard, 60, COOLDOWN_S);
    expect(run(guard, 58, 10)).toBe(false);
  });

  it('treats long stalls (hidden or throttled tab) as noise, not slowness', () => {
    const guard = new FrameRateGuard();
    run(guard, 60, COOLDOWN_S);
    expect(run(guard, 5, 10)).toBe(false);
  });

  it('a brief hitch inside an otherwise smooth window does not fire', () => {
    const guard = new FrameRateGuard();
    run(guard, 60, COOLDOWN_S);
    let fired = run(guard, 60, 1);
    fired = run(guard, 25, 0.3) || fired;
    fired = run(guard, 60, 2) || fired;
    expect(fired).toBe(false);
  });
});
