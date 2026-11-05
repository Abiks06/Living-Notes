import type { AudioFeatures } from './features';

/** Who's playing, in the order the visuals show them. */
export const CAST = [
  { key: 'drums', label: 'Drums' },
  { key: 'bass', label: 'Bass' },
  { key: 'pads', label: 'Pads' },
  { key: 'riffs', label: 'Riffs' },
  { key: 'voice', label: 'Voice' },
] as const;

export type Actor = (typeof CAST)[number]['key'];

/** How much is left of everything else's movement while one part is soloed. */
const BACKGROUND = 0.2;

/** How active each part is right now, 0–1, in `CAST` order. */
export function readCast(audio: AudioFeatures, out: Float32Array): void {
  out[0] = Math.max(audio.kick, audio.snare, audio.hat * 0.6);
  out[1] = audio.bands[0] ?? 0;
  out[2] = audio.sustain;
  out[3] = Math.max(audio.noteHit, audio.noteLevel * 0.6);
  out[4] = audio.vocal;
}

/**
 * Leaves only one part driving the picture, so you can see what it does. It works on what the
 * visuals read rather than the visuals themselves, so every scene follows without knowing.
 */
export function soloActor(audio: AudioFeatures, solo: Actor): void {
  const { bands } = audio;
  if (solo !== 'drums') {
    audio.kick = 0;
    audio.push = 0;
    audio.snare = 0;
    audio.hat = 0;
    audio.beat = 0;
  }
  if (solo !== 'bass') {
    bands[0] = 0;
    bands[1] = 0;
  }
  if (solo !== 'drums' && solo !== 'riffs') {
    for (let band = 2; band < bands.length; band++) bands[band] = (bands[band] ?? 0) * BACKGROUND;
  }
  if (solo !== 'drums' && solo !== 'bass') audio.energy *= BACKGROUND;
  if (solo !== 'pads') audio.sustain = 0;
  if (solo !== 'riffs') {
    audio.noteHit = 0;
    audio.noteLevel = 0;
  }
  if (solo !== 'voice') {
    audio.vocal = 0;
    audio.line.fill(0);
  }
}
