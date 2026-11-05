/**
 * Four colour stops per palette, matching the particle shader:
 * A = cool/quiet, B = body, C = hot/fast, D = treble sparkle.
 */
export type PaletteColors = readonly [string, string, string, string];

export const PALETTES = [
  { key: 'aurora', label: 'Aurora', colors: ['#24166b', '#7b5cff', '#3fe0ff', '#ffe3f7'] },
  { key: 'solar', label: 'Solar Flare', colors: ['#3a0a12', '#d8341c', '#ffb02e', '#fff4d6'] },
  { key: 'bio', label: 'Bioluminescence', colors: ['#032a2e', '#0f8f7c', '#5dffc8', '#e9fff4'] },
  { key: 'cyber', label: 'Cyberpunk', colors: ['#2a0a4a', '#ff2bd6', '#1ff0ff', '#fff36b'] },
  { key: 'mercury', label: 'Mercury', colors: ['#1a1c22', '#6b7280', '#d9dde5', '#ffffff'] },
  { key: 'velvet', label: 'Velvet', colors: ['#1c0817', '#8f1d58', '#ff758f', '#ffe8d6'] },
  { key: 'gold', label: 'Gold Dust', colors: ['#140d04', '#7a4912', '#f5b841', '#fff8e7'] },
] as const satisfies readonly { key: string; label: string; colors: PaletteColors }[];

export type CuratedPaletteKey = (typeof PALETTES)[number]['key'];
export type PaletteKey = CuratedPaletteKey | 'custom';

export const PALETTE_KEYS: readonly PaletteKey[] = [...PALETTES.map((p) => p.key), 'custom'];

export const DEFAULT_CUSTOM_COLORS: PaletteColors = ['#101848', '#4f6bff', '#ff6fd8', '#ffffff'];

export function paletteColors(key: PaletteKey, custom: PaletteColors): PaletteColors {
  if (key === 'custom') return custom;
  return PALETTES.find((p) => p.key === key)?.colors ?? PALETTES[0].colors;
}
