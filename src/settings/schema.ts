import { BAND_COUNT } from '../audio/bands';
import { DEFAULT_SCENE, type MorphShapeKey, type SceneKey } from '../scene/scenes';
import { DEFAULT_CUSTOM_COLORS, type PaletteColors, type PaletteKey } from './palettes';

export const DEFAULT_WORD = 'RESONANCE';
export const MAX_WORD_LENGTH = 16;

/**
 * The wordmark text. It arrives from share links, so it's untrusted: control characters
 * go, whitespace collapses and the length is capped. It's only ever drawn to a canvas.
 */
export function sanitizeWord(raw: string): string {
  const printable = raw.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ');
  return Array.from(printable.trimStart()).slice(0, MAX_WORD_LENGTH).join('');
}

export const PARTICLE_TIERS = ['auto', '65k', '262k', '590k'] as const;
export type ParticleTier = (typeof PARTICLE_TIERS)[number];

/** Everything that defines a "look" — and therefore everything a share link carries. */
export interface Settings {
  scene: SceneKey;
  /** 'auto' cycles on strong beats; otherwise Morph holds this shape. */
  morphShape: MorphShapeKey | 'auto';
  word: string;
  palette: PaletteKey;
  customColors: PaletteColors;
  particles: ParticleTier;
  autoOrbit: boolean;
  /** Hands-free VJ mode: changes scene and palette with the music. */
  autoDirector: boolean;
  /** Per-band multipliers, indexed like `BAND`. */
  sensitivity: readonly number[];
  bloom: number;
  aberration: number;
  trails: number;
  curl: number;
  turbulence: number;
  spring: number;
  pointSize: number;
  dof: number;
}

export type NumericKey =
  'bloom' | 'aberration' | 'trails' | 'curl' | 'turbulence' | 'spring' | 'pointSize' | 'dof';

export interface NumericSpec {
  readonly label: string;
  readonly hint: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  /** Short query key used in the share link. */
  readonly url: string;
}

/**
 * Sliders are multipliers on each scene's own tuning (1 = as designed), so one value
 * means the same thing in every scene and the defaults never need per-scene variants.
 */
export const NUMERIC: Record<NumericKey, NumericSpec> = {
  bloom: {
    label: 'Bloom',
    hint: 'Glow around bright particles',
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    url: 'b',
  },
  aberration: {
    label: 'Chromatic aberration',
    hint: 'Colour fringing on beats',
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    url: 'ca',
  },
  trails: {
    label: 'Trails',
    hint: 'Feedback afterimage length',
    min: 0,
    max: 1.2,
    step: 0.05,
    default: 1,
    url: 't',
  },
  curl: {
    label: 'Curl frequency',
    hint: 'Size of the swirls (higher = finer)',
    min: 0.4,
    max: 2.5,
    step: 0.05,
    default: 1,
    url: 'cf',
  },
  turbulence: {
    label: 'Turbulence',
    hint: 'How hard the flow pushes',
    min: 0,
    max: 2.5,
    step: 0.05,
    default: 1,
    url: 'tu',
  },
  spring: {
    label: 'Spring tension',
    hint: 'How tightly particles hold formation',
    min: 0.3,
    max: 2.5,
    step: 0.05,
    default: 1,
    url: 'sp',
  },
  pointSize: {
    label: 'Point size',
    hint: 'Particle sprite size',
    min: 0.4,
    max: 2.2,
    step: 0.05,
    default: 1,
    url: 'ps',
  },
  dof: {
    label: 'Depth of field',
    hint: 'How softly particles blur away from the focal plane',
    min: 0,
    max: 2.5,
    step: 0.05,
    default: 1,
    url: 'df',
  },
};

export const NUMERIC_KEYS = Object.keys(NUMERIC) as NumericKey[];

export const SENSITIVITY = { min: 0, max: 2.5, step: 0.05, default: 1, url: 'sens' } as const;

export const DEFAULT_SETTINGS: Settings = {
  scene: DEFAULT_SCENE,
  morphShape: 'auto',
  word: DEFAULT_WORD,
  palette: 'aurora',
  customColors: DEFAULT_CUSTOM_COLORS,
  particles: 'auto',
  autoOrbit: true,
  autoDirector: false,
  sensitivity: Array.from({ length: BAND_COUNT }, () => SENSITIVITY.default),
  bloom: NUMERIC.bloom.default,
  aberration: NUMERIC.aberration.default,
  trails: NUMERIC.trails.default,
  curl: NUMERIC.curl.default,
  turbulence: NUMERIC.turbulence.default,
  spring: NUMERIC.spring.default,
  pointSize: NUMERIC.pointSize.default,
  dof: NUMERIC.dof.default,
};

/** Clamp to range and snap to step, so links and sliders always agree. */
export function quantize(value: number, spec: { min: number; max: number; step: number }): number {
  const clamped = Math.min(spec.max, Math.max(spec.min, value));
  const snapped = Math.round((clamped - spec.min) / spec.step) * spec.step + spec.min;
  return Number(snapped.toFixed(4));
}
