import { dprForFps, MIN_DPR, type ConcreteTier } from '../scene/particles/tiers';

/** Below this the frame pacing visibly judders, which is worth a little sharpness to fix. */
export const SMOOTH_FPS = 54;
/** Particles are the show, so they only go when the frame rate is genuinely poor. */
export const LOW_FPS = 45;
const TARGET_FPS = 58;
/** Particles cost little next to post-processing, so losing them only helps a truly bad case. */
const PARTICLE_FPS = 26;

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
 * dropping to 1.25× gained 12 FPS, while dropping from 262k to 65k gained 3. A bad miss jumps
 * straight to the resolution that should fit rather than spending seconds on the steps between.
 * Below 1× is only for a frame rate that's genuinely poor.
 */
export function nextQualityStep(
  fps: number,
  dpr: number,
  tier: ConcreteTier | null,
): QualityStep | null {
  if (fps >= SMOOTH_FPS) return null;
  if (dpr > 1.01) return { kind: 'resolution', dpr: Math.max(1, dprForFps(fps, dpr, TARGET_FPS)) };
  if (fps >= LOW_FPS) return null;
  if (dpr > MIN_DPR + 0.01) return { kind: 'resolution', dpr: dprForFps(fps, dpr, TARGET_FPS) };
  if (fps >= PARTICLE_FPS) return null;
  const lower = tier ? LOWER_TIER[tier] : null;
  return lower ? { kind: 'particles', tier: lower } : { kind: 'floor' };
}
