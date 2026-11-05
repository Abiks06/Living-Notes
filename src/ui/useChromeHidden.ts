import { useEffect, useState } from 'react';
import { isShortcutKey } from '../lib/keyboard';
import { useAppStore } from '../state/appStore';

const IDLE_MS = 3000;
/** Pointer over any of these keeps the UI up: you're reading or about to click. */
const INTERACTIVE = '.chrome, .studio, .toast, .mic-notice, .perf-overlay';

/**
 * Whether the floating UI should fade out: after 3 s with no input (unless the pointer
 * rests on a control, the Studio is open or a notice needs attention), or when hidden
 * with H for streaming/projection, which stays until H or Esc.
 */
export function useChromeHidden(): boolean {
  const phase = useAppStore((state) => state.phase);
  const studioOpen = useAppStore((state) => state.studioOpen);
  const notice = useAppStore((state) => state.notice);
  const mic = useAppStore((state) => state.mic);
  const manual = useAppStore((state) => state.uiHiddenManual);
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    let timer = 0;
    let overUi = false;
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      if (!overUi) timer = window.setTimeout(() => setIdle(true), IDLE_MS);
    };
    const onPointer = (event: PointerEvent) => {
      overUi = event.target instanceof Element && event.target.closest(INTERACTIVE) !== null;
      wake();
    };
    const onKey = (event: KeyboardEvent) => {
      const store = useAppStore.getState();
      if (event.key === 'Escape' && store.lounge) store.setLounge(false);
      else if (event.key === 'Escape' && store.uiHiddenManual) store.setUiHiddenManual(false);
      if ((event.key === 'h' || event.key === 'H') && isShortcutKey(event)) {
        const hide = !store.uiHiddenManual;
        store.setUiHiddenManual(hide);
        if (hide) {
          store.showNotice({
            tone: 'info',
            title: 'Interface hidden',
            body: 'Press H or Esc to bring it back.',
          });
        }
      }
      wake();
    };

    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerdown', onPointer, { passive: true });
    window.addEventListener('wheel', wake, { passive: true });
    window.addEventListener('keydown', onKey);
    wake();
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('wheel', wake);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const needsAttention =
    studioOpen || notice !== null || ['denied', 'missing', 'busy', 'unsupported'].includes(mic);
  return manual || (idle && phase === 'running' && !needsAttention);
}
