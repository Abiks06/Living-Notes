import { describe, expect, it } from 'vitest';
import { nextQualityStep } from './qualityLadder';

describe('nextQualityStep', () => {
  it('leaves a smooth frame rate alone', () => {
    expect(nextQualityStep(58, 1.5, '262k')).toBeNull();
  });

  it('gives up resolution before particles', () => {
    expect(nextQualityStep(50, 1.5, '262k')).toEqual({ kind: 'resolution', dpr: 1.25 });
  });

  it('goes straight to 1× on a bad miss', () => {
    expect(nextQualityStep(33, 1.5, '262k')).toEqual({ kind: 'resolution', dpr: 1 });
  });

  it('keeps every particle for a mild dip once resolution is spent', () => {
    expect(nextQualityStep(50, 1, '262k')).toBeNull();
  });

  it('goes below 1× only for a genuinely poor frame rate', () => {
    expect(nextQualityStep(40, 1, '262k')).toEqual({ kind: 'resolution', dpr: 0.7 });
    expect(nextQualityStep(44, 1, '262k')).toEqual({ kind: 'resolution', dpr: 0.85 });
  });

  it('drops particles only once resolution has nothing left to give', () => {
    expect(nextQualityStep(22, 0.7, '590k')).toEqual({ kind: 'particles', tier: '262k' });
    expect(nextQualityStep(22, 0.7, '262k')).toEqual({ kind: 'particles', tier: '65k' });
  });

  it('keeps the particles at a steady 30 FPS, where losing them would gain almost nothing', () => {
    expect(nextQualityStep(30, 0.7, '262k')).toBeNull();
  });

  it('reports the floor when nothing is left to give up', () => {
    expect(nextQualityStep(22, 0.7, '65k')).toEqual({ kind: 'floor' });
  });
});
