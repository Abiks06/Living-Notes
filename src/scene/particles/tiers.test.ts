import { describe, expect, it } from 'vitest';
import {
  chooseQuality,
  chooseTier,
  lowerDpr,
  predictFrameAtDpr,
  predictFrameMs,
  tierCount,
} from './tiers';

const at262k = (frameMs: number, stepMs: number) => ({
  frameMs,
  stepMs,
  measuredCount: tierCount('262k'),
});

describe('chooseQuality', () => {
  // Measured on a 2× screen: 15.5 ms idle at 1.5× played at 33 FPS; 1× held a clean 60.
  it('moves an integrated GPU on a 2× screen to 1× and keeps its particles', () => {
    expect(chooseQuality(at262k(15.5, 1.3), 1.5, false)).toEqual({ tier: '262k', dpr: 1 });
  });

  it('predicts lower resolutions near what that GPU measured (10.3 and 8.3 ms)', () => {
    expect(predictFrameAtDpr(15.5, 1.5, 1.25)).toBeCloseTo(10.3, -0.5);
    expect(predictFrameAtDpr(15.5, 1.5, 1)).toBeCloseTo(8.3, -0.3);
  });

  it('does not spend the resolution it saved on more particles than the GPU can draw', () => {
    expect(chooseQuality(at262k(15.5, 1.3), 1.5, false).tier).not.toBe('590k');
  });

  it('judges the tier at the chosen resolution, not the measured one', () => {
    expect(chooseTier(at262k(20, 1.3), false)).toBe('65k');
    expect(chooseQuality(at262k(20, 1.3), 1.5, false)).toEqual({ tier: '262k', dpr: 1 });
  });

  it('keeps full resolution when the GPU has room', () => {
    expect(chooseQuality(at262k(6, 0.5), 1.5, false).dpr).toBe(1.5);
  });

  it('settles on the step between when that is enough', () => {
    expect(chooseQuality(at262k(12, 1), 1.5, false).dpr).toBe(1.25);
  });

  it('behaves exactly as chooseTier on a 1× screen', () => {
    expect(chooseQuality(at262k(11.4, 1.3), 1, false)).toEqual({ tier: '262k', dpr: 1 });
    expect(chooseQuality(at262k(3, 0.25), 1, false)).toEqual({ tier: '590k', dpr: 1 });
  });

  it('keeps an in-between device ratio as a starting point', () => {
    expect(chooseQuality(at262k(8, 1), 1.1, false).dpr).toBe(1.1);
  });

  it('leaves resolution alone when the measurement is unusable', () => {
    expect(chooseQuality(at262k(NaN, 1), 1.5, false).dpr).toBe(1.5);
  });
});

describe('lowerDpr', () => {
  it('walks down the steps and stops at 1×', () => {
    expect(lowerDpr(1.5)).toBe(1.25);
    expect(lowerDpr(1.25)).toBe(1);
    expect(lowerDpr(1.1)).toBe(1);
    expect(lowerDpr(1)).toBe(1);
  });
});

describe('chooseTier', () => {
  // Measured: Iris Xe at 1920×1140 runs 262k at ~11.4 ms a frame and misses 60 FPS at 590k.
  it('keeps an integrated GPU at 262k', () => {
    expect(chooseTier(at262k(11.4, 1.3), false)).toBe('262k');
  });

  it('projects 590k close to what was measured on that GPU (14–16 ms)', () => {
    expect(predictFrameMs(at262k(11.4, 1.3), '590k')).toBeGreaterThan(14);
    expect(predictFrameMs(at262k(11.4, 1.3), '590k')).toBeLessThan(18);
  });

  it('stays put on a borderline reading instead of giving up particles for ~1 ms', () => {
    expect(chooseTier(at262k(14.8, 1.8), false)).toBe('262k');
  });

  it('does not upgrade without headroom', () => {
    expect(chooseTier(at262k(11.4, 1.3), false)).not.toBe('590k');
  });

  it('steps a fast discrete GPU up to 590k', () => {
    expect(chooseTier(at262k(3, 0.25), false)).toBe('590k');
  });

  it('drops a slow GPU to 65k', () => {
    expect(chooseTier(at262k(25, 5), false)).toBe('65k');
  });

  it('never picks 590k on touch devices, however fast', () => {
    expect(chooseTier(at262k(2, 0.1), true)).toBe('262k');
  });

  it('falls back to a safe default when the measurement is unusable', () => {
    expect(chooseTier(at262k(Number.NaN, 1), false)).toBe('262k');
    expect(chooseTier(at262k(0, 1), true)).toBe('65k');
  });
});
