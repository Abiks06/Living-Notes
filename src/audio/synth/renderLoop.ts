import { createNoise, type Rig } from './instruments';
import { PATTERNS, type PatternId } from './patterns';

const SAMPLE_RATE = 44100;
const cache = new Map<PatternId, Promise<AudioBuffer>>();

/**
 * Renders a procedural demo loop with an OfflineAudioContext. Offline rendering needs
 * no user gesture, so the first loop is ready before the visitor clicks "start".
 */
export function renderDemoLoop(id: PatternId): Promise<AudioBuffer> {
  const cached = cache.get(id);
  if (cached) return cached;

  const pattern = PATTERNS[id];
  const stepSeconds = 60 / pattern.bpm / 4;
  const seconds = pattern.bars * 16 * stepSeconds;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);

  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -14;
  glue.ratio.value = 3;
  glue.attack.value = 0.005;
  glue.release.value = 0.12;
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(glue).connect(ctx.destination);

  const rig: Rig = { ctx, out: master, noise: createNoise(ctx) };
  pattern.schedule(rig, stepSeconds);

  const rendering = ctx.startRendering();
  rendering.catch(() => cache.delete(id));
  cache.set(id, rendering);
  return rendering;
}
