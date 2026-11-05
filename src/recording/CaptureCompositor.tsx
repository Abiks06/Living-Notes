import { useFrame, useThree } from '@react-three/fiber';
import { afterRender } from './compositor';

/** Runs after the EffectComposer (1) and PerfMonitor (2): the frame is fully drawn. */
const AFTER_RENDER = 3;

export function CaptureCompositor() {
  const canvas = useThree((state) => state.gl.domElement);
  useFrame(() => afterRender(canvas), AFTER_RENDER);
  return null;
}
