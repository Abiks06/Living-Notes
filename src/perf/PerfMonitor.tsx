import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { useSettings } from '../settings/settingsStore';
import { useAppStore } from '../state/appStore';
import { benchmarkProbe } from './benchmarkProbe';
import { FrameRateGuard } from './frameRateGuard';
import { GpuTimer } from './GpuTimer';
import { perfStats } from './perfStats';
import { LOW_FPS, nextQualityStep } from './qualityLadder';

const STATS_INTERVAL_S = 0.5;
/** Runs before every other frame callback, so the GPU query brackets the whole frame. */
const FIRST = -3;
/** Runs after the EffectComposer (priority 1) has drawn the frame. */
const LAST = 2;

/**
 * Frame timing for the F overlay, plus adaptive quality over 3 s windows: resolution first,
 * without comment since it's barely visible, then the particle tier with a quiet toast.
 */
export function PerfMonitor() {
  const gl = useThree((state) => state.gl);
  const overlay = useAppStore((state) => state.perfOverlay);
  const timer = useMemo(() => new GpuTimer(gl.getContext() as WebGL2RenderingContext), [gl]);
  const guard = useRef(new FrameRateGuard());
  const sample = useRef({ frames: 0, elapsed: 0, warnedAtFloor: false });

  useEffect(() => () => timer.dispose(), [timer]);

  useFrame(() => {
    if (overlay && !benchmarkProbe.busy) timer.begin();
  }, FIRST);

  useFrame((_, delta) => {
    if (overlay) timer.end();

    const w = sample.current;
    w.frames++;
    w.elapsed += delta;
    if (w.elapsed >= STATS_INTERVAL_S) {
      perfStats.fps = w.frames / w.elapsed;
      perfStats.frameMs = (w.elapsed / w.frames) * 1000;
      perfStats.gpuMs = timer.supported ? timer.ms : null;
      perfStats.dpr = gl.getPixelRatio();
      w.frames = 0;
      w.elapsed = 0;
    }

    // Never change quality mid-clip: a tier rebuild would glitch the recording.
    if (document.hidden || useAppStore.getState().recording.state === 'recording') {
      guard.current.holdOff();
      return;
    }
    const fps = guard.current.push(delta);
    if (fps === null) return;

    const app = useAppStore.getState();
    const settings = useSettings.getState();
    const current = settings.particles === 'auto' ? app.autoTier : settings.particles;
    const step = nextQualityStep(fps, gl.getPixelRatio(), current);
    if (!step) return;
    guard.current.holdOff();

    if (step.kind === 'resolution') {
      // For this visit only, like the tier: one busy moment shouldn't outlast the page.
      app.setMaxDpr(step.dpr);
    } else if (step.kind === 'particles') {
      if (settings.particles === 'auto') {
        app.setAutoTier(step.tier);
      } else {
        settings.set('particles', step.tier);
      }
      app.showNotice({
        tone: 'info',
        title: `Switched to ${step.tier} particles`,
        body: `The frame rate dipped below ${LOW_FPS} FPS, so the scene was lightened to keep it smooth.`,
      });
    } else if (!w.warnedAtFloor) {
      w.warnedAtFloor = true;
      app.showNotice({
        tone: 'info',
        title: 'This device is working hard',
        body: 'Everything is already at its lightest. Closing other tabs or apps may help.',
      });
    }
  }, LAST);

  return null;
}
