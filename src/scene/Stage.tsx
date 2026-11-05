import { Canvas } from '@react-three/fiber';
import { useAppStore } from '../state/appStore';
import { PerfMonitor } from '../perf/PerfMonitor';
import { TierBenchmark } from '../perf/TierBenchmark';
import { CaptureCompositor } from '../recording/CaptureCompositor';
import { registerStageCanvas } from '../recording/recordingActions';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { AudioClock } from './AudioClock';
import { CameraRig } from './CameraRig';
import { ContextGuard } from './ContextGuard';
import { detectWebGL2 } from './gpuSupport';
import { PointerInput } from './interaction/PointerInput';
import { ParticleField } from './particles/ParticleField';
import { PostFX } from './post/PostFX';
import { MelodyLine } from './MelodyLine';
import { SceneDriver } from './SceneDriver';
import { Strings } from './Strings';

const BACKGROUND = '#05050a';

export function Stage() {
  const gpu = useAppStore((state) => state.gpu);
  const maxDpr = useAppStore((state) => state.maxDpr);
  const support = detectWebGL2();

  if (!support.ok || gpu.state === 'unsupported') {
    const reason = support.ok ? (gpu.state === 'unsupported' ? gpu.reason : '') : support.reason;
    return <FallbackBackdrop reason={reason} />;
  }

  return (
    <ErrorBoundary fallback={<FallbackBackdrop reason="The 3D scene hit an unexpected error." />}>
      <div className="stage" aria-hidden="true">
        <Canvas
          // Owned by the store, not setDpr: this prop is reapplied whenever Stage re-renders.
          dpr={[1, maxDpr]}
          gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
          camera={{ position: [0, 0.6, 8.5], fov: 50, near: 0.1, far: 100 }}
          onCreated={(state) => {
            registerStageCanvas(state.gl.domElement);
            if (import.meta.env.DEV) Object.assign(window, { __r3f: state });
          }}
        >
          <color attach="background" args={[BACKGROUND]} />
          {/* Order matters for equal-priority frame callbacks: audio, then scene state. */}
          <AudioClock />
          <SceneDriver />
          <ContextGuard />
          <CameraRig />
          <PointerInput />
          <ParticleField />
          <MelodyLine />
          <Strings />
          <PostFX />
          {/* Before PerfMonitor: it claims the GPU's one timer slot first when benchmarking. */}
          <TierBenchmark />
          <PerfMonitor />
          <CaptureCompositor />
        </Canvas>
      </div>
    </ErrorBoundary>
  );
}

function FallbackBackdrop({ reason }: { reason: string }) {
  return (
    <div className="stage stage--fallback">
      <div className="fallback-card" role="status">
        <p className="fallback-card__title">Visuals unavailable on this device</p>
        <p className="fallback-card__body">{reason} Your music still plays.</p>
      </div>
    </div>
  );
}
