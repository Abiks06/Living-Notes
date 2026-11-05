import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Vector3 } from 'three';
import { audioFeatures } from '../../audio/features';
import { useReducedMotion } from '../../lib/useMediaQuery';
import { benchmarkProbe } from '../../perf/benchmarkProbe';
import { liveLook } from '../../settings/bindings';
import { DEFAULT_WORD } from '../../settings/schema';
import { useSettings } from '../../settings/settingsStore';
import { useAppStore } from '../../state/appStore';
import { describeGpu } from '../gpuSupport';
import { pointerField } from '../interaction/pointerField';
import { sceneDirector } from '../SceneDirector';
import {
  GpuUnsupportedError,
  ParticleSimulation,
  type SimulationFrame,
} from './ParticleSimulation';
import { flashWordFor } from '../flashWord';
import { provisionalDpr, provisionalTier, TIER_TEXTURE_SIZE } from './tiers';

const WORD_DEBOUNCE_MS = 300;
/** Comfortably past the end of any crossfade, and well before most first drops. */
const WORD_AFTER_START_MS = 2500;

function activeWord(word: string): string {
  return word.trim() || DEFAULT_WORD;
}

export function ParticleField() {
  const gl = useThree((state) => state.gl);
  const setGpu = useAppStore((state) => state.setGpu);
  // A restored WebGL context starts empty: rebuild the simulation from scratch.
  const generation = useAppStore((state) => state.gpuGeneration);
  const autoTier = useAppStore((state) => state.autoTier);
  const particles = useSettings((state) => state.particles);
  const word = useSettings((state) => state.word);
  const autoDirector = useSettings((state) => state.autoDirector);
  const source = useAppStore((state) => state.source);
  const reducedMotion = useReducedMotion();
  const gpuKey = useMemo(() => describeGpu(gl), [gl]);
  const [simulation, setSimulation] = useState<ParticleSimulation | null>(null);
  const frame = useRef<SimulationFrame>({
    dt: 0,
    time: 0,
    pixelRatio: 1,
    motion: 1,
    width: 1,
    height: 1,
    focalDistance: 8.5,
    focus: new Vector3(),
    audio: audioFeatures,
    director: sceneDirector,
    pointer: pointerField,
    look: liveLook,
    stepTimer: null,
  });

  useEffect(() => {
    const store = useAppStore.getState();
    if (store.autoTier === null) {
      store.setAutoTier(provisionalTier(gpuKey));
      store.setMaxDpr(provisionalDpr(gpuKey));
    }
  }, [gpuKey]);

  const tier = particles === 'auto' ? autoTier : particles;
  const textureSize = tier ? TIER_TEXTURE_SIZE[tier] : null;

  useEffect(() => {
    if (textureSize === null) return;
    let sim: ParticleSimulation;
    try {
      sim = new ParticleSimulation(gl, textureSize, activeWord(useSettings.getState().word));
    } catch (error) {
      const reason =
        error instanceof GpuUnsupportedError
          ? error.message
          : 'The particle engine failed to start.';
      setGpu({ state: 'unsupported', reason });
      return;
    }
    setSimulation(sim);
    setGpu({ state: 'ready', precision: sim.precision, particles: sim.count });
    if (import.meta.env.DEV) Object.assign(window, { __particles: { sim, gl } });
    return () => {
      sim.dispose();
      setSimulation(null);
    };
  }, [gl, setGpu, textureSize, generation]);

  // Rasterizing costs ~40 ms at 262k, so wait for a pause in typing.
  useEffect(() => {
    if (!simulation) return;
    const timer = window.setTimeout(() => simulation.setWord(activeWord(word)), WORD_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [simulation, word]);

  // A song's own title is spelled on its first drop, and Auto-VJ spells words on any song. It
  // waits until a song is under way, as rasterizing would stall a crossfade.
  useEffect(() => {
    const titled = source?.kind === 'file' && Boolean(source.title);
    if (!simulation || (!autoDirector && !titled)) return;
    const timer = window.setTimeout(
      () => simulation.setFlashWord(flashWordFor(source, word)),
      titled ? WORD_AFTER_START_MS : WORD_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [simulation, autoDirector, source, word]);

  useFrame((state, delta) => {
    if (!simulation) return;
    const f = frame.current;
    f.dt = delta;
    f.time += Math.min(delta, 0.1);
    f.pixelRatio = state.viewport.dpr;
    f.motion = reducedMotion ? 0.35 : 1;
    f.width = state.size.width * state.viewport.dpr;
    f.height = state.size.height * state.viewport.dpr;
    const target = (state.controls as { target?: Vector3 } | null)?.target;
    if (target) {
      f.focalDistance = state.camera.position.distanceTo(target);
      f.focus.copy(target);
    }
    f.stepTimer = benchmarkProbe.stepTimer;
    simulation.step(f);
  });

  if (!simulation) return null;
  return (
    <points geometry={simulation.geometry} material={simulation.material} frustumCulled={false} />
  );
}
