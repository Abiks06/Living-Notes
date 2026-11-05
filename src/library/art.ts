import { Color } from 'three';
import type { PaletteColors } from '../settings/palettes';
import type { Track } from './library';

const THUMB = 96;
const LARGE = 512;
const SAMPLE = 32;
/** Decoding is the slow part, and nobody can see more than a screenful at once. */
const MAX_AT_ONCE = 3;
const MAX_CACHED = 400;
const HUE_BINS = 24;
const MIN_COLOURFUL = 0.08;
const MIN_HUE_GAP = 4;

const urls = new Map<string, Promise<string | null>>();
let active = 0;
const waiting: (() => void)[] = [];

async function turn<T>(job: () => Promise<T>): Promise<T> {
  if (active >= MAX_AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await job();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

async function coverOf(track: Track): Promise<Blob | null> {
  const { cover } = track;
  if (!cover) return null;
  const file = await track.open();
  return file.slice(cover.offset, cover.offset + cover.length, cover.type);
}

async function render(track: Track, size: number): Promise<string | null> {
  try {
    const blob = await coverOf(track);
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob, {
      resizeWidth: size,
      resizeHeight: size,
      resizeQuality: 'medium',
    });
    const canvas = new OffscreenCanvas(size, size);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    const small = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
    return URL.createObjectURL(small);
  } catch {
    return null;
  }
}

/** A cover image as a URL at a size. Albums share covers, so they share the work too. */
export function artFor(track: Track, large = false): Promise<string | null> {
  if (!track.cover) return Promise.resolve(null);
  const key = `${track.album || track.id}|${track.cover.length}|${large ? 'l' : 's'}`;
  const known = urls.get(key);
  if (known) return known;
  if (urls.size >= MAX_CACHED) {
    const oldest = urls.keys().next().value;
    if (oldest !== undefined) {
      void urls.get(oldest)?.then((url) => url && URL.revokeObjectURL(url));
      urls.delete(oldest);
    }
  }
  const made = turn(() => render(track, large ? LARGE : THUMB));
  urls.set(key, made);
  return made;
}

const hex = (hue: number, saturation: number, lightness: number) =>
  `#${new Color().setHSL(hue, saturation, lightness).getHexString()}`;

/**
 * A palette from a picture's own colours: its strongest hue for the body, and the next strongest
 * clearly different one for the highlights. Null for art with no real colour to give, which
 * should keep the palette already chosen.
 */
export function paletteFromPixels(rgba: Uint8ClampedArray): PaletteColors | null {
  const weights = new Float32Array(HUE_BINS);
  const colour = new Color();
  const hsl = { h: 0, s: 0, l: 0 };
  let total = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    colour.setRGB((rgba[i] ?? 0) / 255, (rgba[i + 1] ?? 0) / 255, (rgba[i + 2] ?? 0) / 255);
    colour.getHSL(hsl);
    // Vivid mid-tones say the most about a picture; near-black and near-white say nothing.
    const weight = hsl.s * (1 - Math.abs(hsl.l - 0.5) * 2);
    const bin = Math.floor(hsl.h * HUE_BINS) % HUE_BINS;
    weights[bin] = (weights[bin] ?? 0) + weight;
    total += weight;
  }
  if (total / (rgba.length / 4) < MIN_COLOURFUL) return null;

  let first = 0;
  for (let bin = 1; bin < HUE_BINS; bin++) {
    if ((weights[bin] ?? 0) > (weights[first] ?? 0)) first = bin;
  }
  let second = (first + HUE_BINS / 2) % HUE_BINS;
  let top = 0;
  for (let bin = 0; bin < HUE_BINS; bin++) {
    const apart = Math.abs(bin - first);
    if (Math.min(apart, HUE_BINS - apart) < MIN_HUE_GAP) continue;
    if ((weights[bin] ?? 0) > top) {
      top = weights[bin] ?? 0;
      second = bin;
    }
  }
  const main = (first + 0.5) / HUE_BINS;
  const accent = (second + 0.5) / HUE_BINS;
  return [
    hex(main, 0.7, 0.13),
    hex(main, 0.8, 0.5),
    hex(accent, 0.9, 0.62),
    hex(accent, 0.45, 0.92),
  ];
}

/** The colours of a track's cover, if it has any worth using. */
export async function paletteFor(track: Track): Promise<PaletteColors | null> {
  try {
    const blob = await coverOf(track);
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob, { resizeWidth: SAMPLE, resizeHeight: SAMPLE });
    const canvas = new OffscreenCanvas(SAMPLE, SAMPLE);
    const context = canvas.getContext('2d');
    context?.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context?.getImageData(0, 0, SAMPLE, SAMPLE).data;
    return pixels ? paletteFromPixels(pixels) : null;
  } catch {
    return null;
  }
}
