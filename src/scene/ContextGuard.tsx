import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { useAppStore } from '../state/appStore';

/** How long to wait for the browser to hand the context back before giving up. */
const RESTORE_TIMEOUT_MS = 5000;

/**
 * Recovers from WebGL context loss (GPU reset, driver update, too many tabs).
 * `preventDefault` on loss asks the browser to restore; on restore we bump a generation
 * counter so the particle simulation — whose float render targets are gone — is rebuilt.
 */
export function ContextGuard() {
  const canvas = useThree((state) => state.gl.domElement);

  useEffect(() => {
    const { setGpu, bumpGpuGeneration, showNotice, dismissNotice } = useAppStore.getState();
    let timeout = 0;

    const onLost = (event: Event) => {
      event.preventDefault();
      setGpu({ state: 'lost' });
      showNotice({
        tone: 'info',
        title: 'Graphics paused',
        body: 'The GPU reset. Reconnecting — your audio keeps playing.',
      });
      timeout = window.setTimeout(() => {
        setGpu({
          state: 'unsupported',
          reason: 'The graphics context was lost and did not come back.',
        });
      }, RESTORE_TIMEOUT_MS);
    };

    const onRestored = () => {
      window.clearTimeout(timeout);
      dismissNotice();
      bumpGpuGeneration();
    };

    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    return () => {
      window.clearTimeout(timeout);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    };
  }, [canvas]);

  return null;
}
