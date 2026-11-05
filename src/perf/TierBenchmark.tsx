import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { describeGpu } from '../scene/gpuSupport';
import {
  cachedTier,
  chooseQuality,
  isTouchDevice,
  rememberQuality,
  tierCount,
} from '../scene/particles/tiers';
import { useSettings } from '../settings/settingsStore';
import { useAppStore } from '../state/appStore';
import { benchmarkProbe } from './benchmarkProbe';
import { GpuTimer } from './GpuTimer';

/** Let shaders compile and the GPU clock up before trusting any timing. */
const WARM_UP_FRAMES = 45;
const SAMPLES_PER_PHASE = 12;
/** Give up if the driver never returns results. */
const MAX_FRAMES_PER_PHASE = 120;
/**
 * Anything slower means a throttled or background page, whose idle GPU sits at low clocks
 * and would read as a weak one. Such samples are thrown away rather than cached.
 */
const STALLED_FRAME_S = 0.05;
const FIRST = -3;
const LAST = 2;

type Phase = 'waiting' | 'frame' | 'step' | 'done';

/**
 * Picks the resolution and particle tier from timer queries alone: first a whole frame, then
 * just the simulation step. Results arrive asynchronously, so measuring never stalls the pipeline.
 * Browsers without timer queries keep the device default and rely on the adaptive
 * step-down: a readback-based timing was tried and overstated cost by about 25×.
 */
export function TierBenchmark() {
  const gl = useThree((state) => state.gl);
  const particles = useSettings((state) => state.particles);
  const autoTier = useAppStore((state) => state.autoTier);
  const generation = useAppStore((state) => state.gpuGeneration);
  const gpuKey = useMemo(() => describeGpu(gl), [gl]);
  const run = useRef({
    phase: 'waiting' as Phase,
    frames: 0,
    frameMs: 0,
    timer: null as GpuTimer | null,
  });

  // Waiting again covers switching to Auto later and a restored GPU context. A finished
  // run stays finished, so the rebuild its own result triggers can't start another.
  useEffect(() => {
    const r = run.current;
    if (r.phase === 'waiting') r.frames = 0;
  }, [particles, autoTier, generation]);

  useEffect(() => {
    const r = run.current;
    if (import.meta.env.DEV) Object.assign(window, { __benchmark: r });
    return () => {
      benchmarkProbe.busy = false;
      benchmarkProbe.stepTimer = null;
      r.timer?.dispose();
    };
  }, []);

  useFrame((_, delta) => {
    const r = run.current;
    if (r.phase === 'done' || particles !== 'auto' || autoTier === null) return;
    if (delta > STALLED_FRAME_S) {
      r.timer?.dispose();
      r.timer = null;
      r.phase = 'waiting';
      r.frames = 0;
      benchmarkProbe.busy = false;
      benchmarkProbe.stepTimer = null;
      return;
    }
    if (r.phase === 'waiting') {
      if (document.hidden || ++r.frames < WARM_UP_FRAMES) return;
      const timer = new GpuTimer(gl.getContext() as WebGL2RenderingContext);
      if (!timer.supported || cachedTier(gpuKey) !== null) {
        r.phase = 'done';
        return;
      }
      r.timer = timer;
      r.phase = 'frame';
      r.frames = 0;
      benchmarkProbe.busy = true;
    }
    if (r.phase === 'frame') r.timer?.begin();
  }, FIRST);

  useFrame(() => {
    const r = run.current;
    const timer = r.timer;
    if (!timer || (r.phase !== 'frame' && r.phase !== 'step')) return;
    if (r.phase === 'frame') timer.end();
    r.frames++;

    const stop = () => {
      timer.dispose();
      r.timer = null;
      r.phase = 'done';
      benchmarkProbe.busy = false;
      benchmarkProbe.stepTimer = null;
    };

    if (particles !== 'auto' || r.frames > MAX_FRAMES_PER_PHASE) {
      stop();
      return;
    }
    if (timer.samples < SAMPLES_PER_PHASE) return;

    if (r.phase === 'frame') {
      r.frameMs = timer.ms ?? 0;
      timer.dispose();
      const stepTimer = new GpuTimer(gl.getContext() as WebGL2RenderingContext);
      r.timer = stepTimer;
      r.phase = 'step';
      r.frames = 0;
      benchmarkProbe.stepTimer = stepTimer;
      return;
    }

    const stepMs = timer.ms ?? 0;
    stop();
    const store = useAppStore.getState();
    const measuredAt = store.autoTier;
    if (!measuredAt) return;
    const measurement = { frameMs: r.frameMs, stepMs, measuredCount: tierCount(measuredAt) };
    const measuredDpr = gl.getPixelRatio();
    const quality = chooseQuality(measurement, measuredDpr, isTouchDevice());
    rememberQuality(gpuKey, quality);
    store.setBenchmark({
      frameMs: r.frameMs,
      stepMs,
      measuredAt,
      measuredDpr,
      picked: quality.tier,
      dpr: quality.dpr,
    });
    store.setMaxDpr(quality.dpr);
    if (quality.tier !== measuredAt) store.setAutoTier(quality.tier);
  }, LAST);

  return null;
}
