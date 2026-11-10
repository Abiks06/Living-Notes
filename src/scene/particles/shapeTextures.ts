import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';
import { DEFAULT_WORD } from '../../settings/schema';
import { wordLines } from '../wordLayout';

/**
 * Point-cloud targets that can't be written as a closed-form function of the particle
 * index: the "LIVING NOTES" wordmark and the Lorenz attractor. One texel per particle,
 * laid out exactly like the simulation textures so the shader can `texelFetch` them.
 */

function createTargetTexture(size: number, data: Float32Array): DataTexture {
  const texture = new DataTexture(data, size, size, RGBAFormat, FloatType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/** About 2 ms of work: floats in the target array, four to a particle. */
const GENTLE_SLICE = 4 * 16384;
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 220;
const FONT_PX = 150;
const FONT_STACK = '"Arial Black", "Segoe UI", system-ui, sans-serif';
const MAX_WORLD_WIDTH = 7.4;
const MAX_WORLD_HEIGHT = 2.2;
/** Several lines stack taller than one, but still have to clear the top and bottom of the view. */
const MAX_BLOCK_HEIGHT = 3.3;
/** Past this, at full size, one line would shrink too far for particles to spell it clearly. */
const COMFORTABLE_WIDTH = CANVAS_WIDTH * 1.7;
const LINE_SPACING = 1.12;

interface Raster {
  filled: number[];
  scale: number;
  height: number;
}

/** Draws the word and returns the filled pixels plus its fitted world scale. */
function rasterizeWord(word: string): Raster | null {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.font = `900 ${FONT_PX}px ${FONT_STACK}`;
  const lines = wordLines(word, (text) => ctx.measureText(text).width, COMFORTABLE_WIDTH);
  // Long words and wide fallback fonts shrink to fit the canvas.
  const natural = Math.max(...lines.map((line) => ctx.measureText(line).width));
  const fit = Math.min(1, (CANVAS_WIDTH * 0.94) / Math.max(natural, 1));
  const fontPx = Math.floor(FONT_PX * fit);
  const lineHeight = fontPx * LINE_SPACING;
  const blockHeight = fontPx + (lines.length - 1) * lineHeight;
  const height = Math.max(CANVAS_HEIGHT, Math.ceil(blockHeight + 60));

  // Resizing clears the canvas and everything set on it.
  canvas.height = height;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${fontPx}px ${FONT_STACK}`;
  lines.forEach((line, i) => {
    const offset = (i - (lines.length - 1) / 2) * lineHeight;
    ctx.fillText(line, CANVAS_WIDTH / 2, height / 2 + 6 + offset);
  });

  const pixels = ctx.getImageData(0, 0, CANVAS_WIDTH, height).data;
  const filled: number[] = [];
  for (let i = 0; i < CANVAS_WIDTH * height; i++) {
    if ((pixels[i * 4 + 3] ?? 0) > 128) filled.push(i);
  }
  const drawnWidth = Math.max(natural * fit, 1);
  const maxHeight = lines.length > 1 ? MAX_BLOCK_HEIGHT : MAX_WORLD_HEIGHT;
  // Short words grow to fill the frame instead of sitting small in the middle.
  const scale = Math.min(
    MAX_WORLD_WIDTH / drawnWidth,
    maxHeight / (lines.length > 1 ? blockHeight : FONT_PX * fit),
  );
  return { filled, scale, height };
}

/** Writes one target per particle, sampled from the word's filled pixels. */
function rasterWithFallback(word: string) {
  const raster = rasterizeWord(word);
  // A word of glyphs this device can't draw would otherwise collapse to a single point.
  return raster?.filled.length === 0 ? rasterizeWord(DEFAULT_WORD) : raster;
}

function fillRange(
  data: Float32Array,
  from: number,
  to: number,
  { filled, scale, height }: Raster,
): void {
  for (let i = from; i < to; i += 4) {
    const pixel = filled[Math.floor(Math.random() * filled.length)] ?? 0;
    const x = (pixel % CANVAS_WIDTH) + Math.random();
    const y = Math.floor(pixel / CANVAS_WIDTH) + Math.random();
    data[i] = (x - CANVAS_WIDTH / 2) * scale;
    data[i + 1] = -(y - height / 2) * scale;
    data[i + 2] = (Math.random() - 0.5) * 0.35;
    data[i + 3] = 1;
  }
}

export function fillTextTargets(data: Float32Array, word: string): void {
  const raster = rasterWithFallback(word);
  if (raster) fillRange(data, 0, data.length, raster);
}

/**
 * The same, a slice per frame, for a word that's needed during a song: doing it all at once takes
 * several frames' worth of time, which would show as a stutter in the music's visuals.
 */
export async function fillTextTargetsGently(data: Float32Array, word: string): Promise<void> {
  const raster = rasterWithFallback(word);
  if (!raster) return;
  for (let from = 0; from < data.length; from += GENTLE_SLICE) {
    fillRange(data, from, Math.min(data.length, from + GENTLE_SLICE), raster);
    await new Promise((resolve) => window.setTimeout(resolve, 16));
  }
}

export function createTextTargets(size: number, word: string): DataTexture {
  const data = new Float32Array(size * size * 4);
  fillTextTargets(data, word);
  return createTargetTexture(size, data);
}

/**
 * One long Lorenz trajectory (σ=10, ρ=28, β=8/3), stored in order. Because consecutive
 * texels are consecutive points in time, the shader can advance each particle's index
 * to make the whole cloud flow along the butterfly.
 */
export function createLorenzTargets(size: number): DataTexture {
  const count = size * size;
  const data = new Float32Array(count * 4);
  const dt = 0.004;
  let x = 0.1;
  let y = 0;
  let z = 0;
  const step = () => {
    const dx = 10 * (y - x);
    const dy = x * (28 - z) - y;
    const dz = x * y - (8 / 3) * z;
    x += dx * dt;
    y += dy * dt;
    z += dz * dt;
  };
  for (let i = 0; i < 2000; i++) step(); // settle onto the attractor

  const scale = 0.095;
  for (let p = 0; p < count; p++) {
    step();
    step();
    // Lorenz x/z is the classic "butterfly" view; map it onto the screen plane.
    data[p * 4] = x * scale;
    data[p * 4 + 1] = (z - 24) * scale;
    data[p * 4 + 2] = y * scale * 0.6;
    data[p * 4 + 3] = 1;
  }
  return createTargetTexture(size, data);
}
