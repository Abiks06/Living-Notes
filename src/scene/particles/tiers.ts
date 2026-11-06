import type { ParticleTier } from '../../settings/schema';

export type ConcreteTier = Exclude<ParticleTier, 'auto'>;

/** Particle counts are square textures: one texel per particle. */
export const TIER_TEXTURE_SIZE: Record<ConcreteTier, number> = {
  '65k': 256,
  '262k': 512,
  '590k': 768,
};

const ORDER: readonly ConcreteTier[] = ['65k', '262k', '590k'];

/** Brightness of the base tier; denser tiers dim each particle to keep the total even. */
export const REFERENCE_COUNT = TIER_TEXTURE_SIZE['65k'] ** 2;

/** Moving up a tier needs this much headroom under the 16.7 ms frame at 60 FPS. */
const UPGRADE_BUDGET_MS = 13;
/**
 * Staying at (or above) a tier only needs to actually fit the frame. The gap between the two
 * budgets is deliberate: post-processing dominates the frame, so dropping particles saves
 * little, and a borderline reading shouldn't cost three-quarters of them.
 */
const KEEP_BUDGET_MS = 16;
/**
 * How much of the frame scales with particle count, relative to the simulation step alone
 * (the rest is drawing the points). Measured on Iris Xe: 262k → 590k added ~3 ms of frame
 * time for ~0.8 ms of simulation. Post-processing is the large part that does not scale.
 */
const PARTICLE_COST_PER_SIM_MS = 3.5;

/** Above this the extra sharpness doesn't show through bloom, and fill cost keeps climbing. */
export const MAX_DPR = 1.5;
/** Soft through bloom, but a smooth picture at this size beats a sharp one at half the speed. */
export const MIN_DPR = 0.7;
/** Where a first visit begins. Starting high left weak GPUs at 11 FPS until they stepped down. */
export const START_DPR = 1;
const DPR_STEPS: readonly number[] = [MAX_DPR, 1.25, 1, 0.85, MIN_DPR];
/**
 * An idle frame has to fit this to keep a resolution, well under 16.7 ms because the benchmark
 * can't see two costs on the same GPU: the browser compositing the page, and the extra
 * overdraw once music plays. Measured on Iris Xe on a 2× screen, 262k: an idle 15.5 ms at 1.5×
 * played at 33 FPS, 10.3 ms at 1.25× played at 48, and 8.3 ms at 1× held a clean 60.
 */
const RESOLUTION_BUDGET_MS = 10;
/** Below 1×, the frame only has to fit 60 FPS. */
const SMOOTH_FRAME_MS = 15;
/**
 * Share of the frame that scales with pixel count. The same GPU fits about 0.85; rounding
 * down keeps the prediction from promising more than a lower resolution will really save.
 */
const FILL_SHARE = 0.8;

export function tierCount(tier: ConcreteTier): number {
  return TIER_TEXTURE_SIZE[tier] ** 2;
}

export function isTouchDevice(): boolean {
  return (
    window.matchMedia('(pointer: coarse)').matches ||
    Math.min(window.screen.width, window.screen.height) < 700
  );
}

export interface TierMeasurement {
  /** Whole-frame GPU time at the measured tier. */
  frameMs: number;
  /** GPU time of the simulation step alone. */
  stepMs: number;
  measuredCount: number;
}

/** Projected whole-frame GPU time at another tier. */
export function predictFrameMs(m: TierMeasurement, tier: ConcreteTier): number {
  const scale = tierCount(tier) / m.measuredCount - 1;
  return m.frameMs + PARTICLE_COST_PER_SIM_MS * m.stepMs * scale;
}

/**
 * Picks the largest tier projected to fit its budget. Touch devices stop at 262k:
 * phones throttle under sustained load long before a short benchmark shows it.
 */
export function chooseTier(m: TierMeasurement, touch: boolean): ConcreteTier {
  const usable = Number.isFinite(m.frameMs) && m.frameMs > 0 && Number.isFinite(m.stepMs);
  if (!usable) return touch ? '65k' : '262k';
  let best: ConcreteTier = '65k';
  for (const tier of ORDER) {
    if (touch && tier === '590k') break;
    const budget = tierCount(tier) > m.measuredCount ? UPGRADE_BUDGET_MS : KEEP_BUDGET_MS;
    if (predictFrameMs(m, tier) <= budget) best = tier;
  }
  return best;
}

/** Projected whole-frame GPU time at another render resolution. */
export function predictFrameAtDpr(frameMs: number, measuredDpr: number, dpr: number): number {
  return frameMs * (1 - FILL_SHARE + FILL_SHARE * (dpr / measuredDpr) ** 2);
}

/** The next resolution down from `dpr`. */
export function lowerDpr(dpr: number): number {
  return DPR_STEPS.find((step) => step < dpr - 0.01) ?? MIN_DPR;
}

/** The resolution step that should bring `fps` close to smooth, as cost follows pixel count. */
export function dprForFps(fps: number, dpr: number, targetFps: number): number {
  const target = dpr * Math.sqrt(fps / targetFps);
  return DPR_STEPS.find((step) => step <= target + 0.01 && step < dpr - 0.01) ?? MIN_DPR;
}

export interface Quality {
  tier: ConcreteTier;
  dpr: number;
}

/**
 * Resolution first, then particles: post-processing and overdraw scale with pixels, so on a
 * high-DPI screen resolution is both the bigger saving and the less visible loss. The tier is
 * then judged at that resolution, or a 2× screen would cost particles it can actually afford.
 */
export function chooseQuality(
  m: TierMeasurement,
  measuredDpr: number,
  touch: boolean,
  ceiling = measuredDpr,
): Quality {
  if (!Number.isFinite(m.frameMs) || m.frameMs <= 0) {
    return { tier: chooseTier(m, touch), dpr: measuredDpr };
  }
  const predict = (step: number) => predictFrameAtDpr(m.frameMs, measuredDpr, step);
  const top = Math.max(ceiling, measuredDpr);
  const steps = [top, ...DPR_STEPS.filter((step) => step < top - 0.01)];
  // Sharpness above 1× has to leave headroom. Going below 1× is only for what can't hold 60.
  const sharp = steps.filter((step) => step >= 1).find((s) => predict(s) <= RESOLUTION_BUDGET_MS);
  const dpr =
    sharp ??
    steps.find((step) => step <= 1 && predict(step) <= SMOOTH_FRAME_MS) ??
    steps[steps.length - 1] ??
    measuredDpr;
  const frameMs = predictFrameAtDpr(m.frameMs, measuredDpr, dpr);
  return { tier: chooseTier({ ...m, frameMs }, touch), dpr };
}

// v1 came from a readback benchmark that overstated cost ~25×; v2 chose a tier without
// considering resolution. Neither is worth reusing.
const CACHE_KEY = 'resonance.quality.v3';

function readCache(gpu: string): Quality | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const cached = raw ? (JSON.parse(raw) as { gpu?: string; tier?: string; dpr?: number }) : null;
    const dpr = cached?.dpr;
    if (
      cached?.gpu === gpu &&
      ORDER.includes(cached.tier as ConcreteTier) &&
      typeof dpr === 'number' &&
      dpr >= MIN_DPR &&
      dpr <= MAX_DPR
    ) {
      return { tier: cached.tier as ConcreteTier, dpr };
    }
  } catch {
    // Storage blocked or corrupt: just benchmark again.
  }
  return null;
}

/** Last benchmark result for this GPU, so return visits start at the right tier. */
export function cachedTier(gpu: string): ConcreteTier | null {
  return readCache(gpu)?.tier ?? null;
}

/** The resolution to start from, before anything has been measured on this visit. */
export function provisionalDpr(gpu: string): number {
  return readCache(gpu)?.dpr ?? START_DPR;
}

export function rememberQuality(gpu: string, quality: Quality): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ gpu, ...quality }));
  } catch {
    // Private mode etc. — the benchmark simply reruns next visit.
  }
}

/** Best guess before measuring: the cached result, else a device-class default. */
export function provisionalTier(gpu: string): ConcreteTier {
  return cachedTier(gpu) ?? (isTouchDevice() ? '65k' : '262k');
}
