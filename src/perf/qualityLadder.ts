import { lowerDpr, type ConcreteTier } from '../scene/particles/tiers';

/** Below this the frame pacing visibly judders, which is worth a little sharpness to fix. */
export const SMOOTH_FPS = 54;
/** Particles are the show, so they only go when the frame rate is genuinely poor. */
export const LOW_FPS = 45;

const LOWER_TIER: Record<ConcreteTier, ConcreteTier | null> = {
  '590k': '262k',
  '262k': '65k',
  '65k': null,
};

export type QualityStep =
  | { kind: 'resolution'; dpr: number }
  | { kind: 'particles'; tier: ConcreteTier }
  | { kind: 'floor' };

/**
 * What to give up for a window that averaged `fps`. Resolution goes first: on Iris Xe at 1.5×,
 * dropping to 1.25× gained 12 FPS, while dropping from 262k to 65k gained 3. A bad miss skips
 * straight to 1× rather than spending another few seconds on the step between.
 */
export function nextQualityStep(
  fps: number,
  dpr: number,
  tier: ConcreteTier | null,
): QualityStep | null {
  if (fps >= SMOOTH_FPS) return null;
  if (dpr > 1.01) return { kind: 'resolution', dpr: fps < LOW_FPS ? 1 : lowerDpr(dpr) };
  if (fps >= LOW_FPS) return null;
  const lower = tier ? LOWER_TIER[tier] : null;
  return lower ? { kind: 'particles', tier: lower } : { kind: 'floor' };
}
