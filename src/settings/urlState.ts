import { MORPH_SHAPES, type MorphShapeKey, SCENES, type SceneKey } from '../scene/scenes';
import { PALETTE_KEYS, type PaletteColors, type PaletteKey } from './palettes';
import {
  DEFAULT_SETTINGS,
  NUMERIC,
  NUMERIC_KEYS,
  PARTICLE_TIERS,
  type ParticleTier,
  quantize,
  sanitizeWord,
  SENSITIVITY,
  type Settings,
} from './schema';

/**
 * Share links: settings <-> URL hash. Only values that differ from the defaults are
 * written, so a default look is a bare URL and tweaked looks stay short. Decoding treats
 * the hash as untrusted input: unknown keys are ignored, enums are whitelisted, numbers
 * are clamped and snapped to their slider step, colours must be 6-digit hex.
 */

const VERSION = '1';
const HEX = /^[0-9a-f]{6}$/i;
/** '_' and '-' survive URLSearchParams unescaped (',' would become %2C). */
const LIST_SEPARATOR = '_';
const SCENE_KEYS: readonly string[] = SCENES.map((scene) => scene.key);
const SHAPE_KEYS: readonly string[] = MORPH_SHAPES.map((shape) => shape.key);

function format(value: number): string {
  return String(Number(value.toFixed(4)));
}

export function encodeSettings(settings: Settings): string {
  const params = new URLSearchParams();
  if (settings.scene !== DEFAULT_SETTINGS.scene) params.set('s', settings.scene);
  if (settings.morphShape !== DEFAULT_SETTINGS.morphShape) params.set('ms', settings.morphShape);
  const word = settings.word.trim();
  if (word && word !== DEFAULT_SETTINGS.word) params.set('w', word);
  if (settings.palette !== DEFAULT_SETTINGS.palette) params.set('p', settings.palette);
  if (settings.palette === 'custom') {
    params.set('cc', settings.customColors.map((c) => c.replace('#', '').toLowerCase()).join('-'));
  }
  if (settings.particles !== DEFAULT_SETTINGS.particles) params.set('n', settings.particles);
  if (settings.autoOrbit !== DEFAULT_SETTINGS.autoOrbit)
    params.set('o', settings.autoOrbit ? '1' : '0');

  if (!settings.autoDirector) params.set('ad', '0');

  for (const key of NUMERIC_KEYS) {
    if (settings[key] !== NUMERIC[key].default) params.set(NUMERIC[key].url, format(settings[key]));
  }
  if (settings.sensitivity.some((v, i) => v !== DEFAULT_SETTINGS.sensitivity[i])) {
    params.set(SENSITIVITY.url, settings.sensitivity.map(format).join(LIST_SEPARATOR));
  }

  if ([...params.keys()].length === 0) return '';
  params.set('v', VERSION);
  return params.toString();
}

function parseNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function decodeSettings(hash: string): Partial<Settings> {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const out: Partial<Settings> = {};

  const scene = params.get('s');
  if (scene && SCENE_KEYS.includes(scene)) out.scene = scene as SceneKey;

  const shape = params.get('ms');
  if (shape && SHAPE_KEYS.includes(shape)) out.morphShape = shape as MorphShapeKey;

  const word = params.get('w');
  if (word !== null) {
    const clean = sanitizeWord(word).trim();
    if (clean) out.word = clean;
  }

  const palette = params.get('p');
  if (palette && (PALETTE_KEYS as readonly string[]).includes(palette)) {
    out.palette = palette as PaletteKey;
  }

  const colors = params.get('cc')?.split('-');
  if (colors?.length === 4 && colors.every((c) => HEX.test(c))) {
    out.customColors = colors.map((c) => `#${c.toLowerCase()}`) as unknown as PaletteColors;
  }

  const tier = params.get('n');
  if (tier && (PARTICLE_TIERS as readonly string[]).includes(tier))
    out.particles = tier as ParticleTier;

  const director = params.get('ad');
  if (director === '0') out.autoDirector = false;

  const orbit = params.get('o');
  if (orbit === '0' || orbit === '1') out.autoOrbit = orbit === '1';

  for (const key of NUMERIC_KEYS) {
    const value = parseNumber(params.get(NUMERIC[key].url));
    if (value !== null) out[key] = quantize(value, NUMERIC[key]);
  }

  const bands = params.get(SENSITIVITY.url)?.split(LIST_SEPARATOR);
  if (bands?.length === DEFAULT_SETTINGS.sensitivity.length) {
    out.sensitivity = bands.map((raw, i) => {
      const value = parseNumber(raw);
      return value === null ? (DEFAULT_SETTINGS.sensitivity[i] ?? 1) : quantize(value, SENSITIVITY);
    });
  }
  return out;
}

export function settingsFromHash(hash: string): Settings {
  return { ...DEFAULT_SETTINGS, ...decodeSettings(hash) };
}
