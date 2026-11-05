import { describe, expect, it } from 'vitest';
import { cropRect, framingFactor, outputSize } from './framing';

describe('cropRect', () => {
  it('keeps the whole frame for "window"', () => {
    expect(cropRect(1920, 1140, 'window')).toEqual({ x: 0, y: 0, width: 1920, height: 1140 });
  });

  it('takes a centred vertical slice from a landscape window', () => {
    const crop = cropRect(1920, 1140, '9:16');
    expect(crop.height).toBe(1140);
    expect(crop.width).toBeCloseTo(641.25);
    expect(crop.x + crop.width / 2).toBeCloseTo(960);
  });

  it('takes a centred horizontal slice from a portrait window', () => {
    const crop = cropRect(750, 1600, '16:9');
    expect(crop.width).toBe(750);
    expect(crop.height).toBeCloseTo(421.875);
    expect(crop.y + crop.height / 2).toBeCloseTo(800);
  });
});

describe('outputSize', () => {
  it('uses standard upload sizes for fixed aspects', () => {
    const crop = cropRect(1920, 1140, '9:16');
    expect(outputSize(crop, '9:16')).toEqual({ width: 720, height: 1280 });
  });

  it('rounds window recordings to even dimensions for the encoder', () => {
    expect(outputSize({ x: 0, y: 0, width: 1921, height: 1139 }, 'window')).toEqual({
      width: 1922,
      height: 1140,
    });
  });
});

describe('framingFactor', () => {
  it('leaves the camera alone unless the crop is narrower', () => {
    expect(framingFactor(1.68, 'window')).toBe(1);
    expect(framingFactor(1.68, '16:9')).toBe(1);
    expect(framingFactor(1.68, '1:1')).toBe(1);
  });

  it('backs off for a vertical clip from a landscape window', () => {
    expect(framingFactor(1.68, '9:16')).toBeCloseTo(0.8 / (9 / 16));
  });

  it('accounts for a portrait window that is already backed off', () => {
    expect(framingFactor(0.46, '9:16')).toBe(1);
  });
});
