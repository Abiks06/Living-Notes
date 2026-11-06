import { useEffect } from 'react';
import { useLibrary } from '../library/library';
import { useAppStore } from '../state/appStore';

const EDGE_PX = 12;
/** Long enough that a mouse passing through on its way somewhere doesn't set it off. */
const OPEN_AFTER_MS = 120;
const CLOSE_AFTER_MS = 400;
/** Matches the slide out in the stylesheet. */
const LEAVING_MS = 160;

/** Nothing slides in over the show while it's meant to be left alone. */
function showIsClear(): boolean {
  const { phase, lounge, uiHiddenManual, recording } = useAppStore.getState();
  return phase === 'running' && !lounge && !uiHiddenManual && recording.state === 'idle';
}

/** Someone halfway through a search hasn't finished with it, wherever the mouse has wandered. */
function typingInLibrary(): boolean {
  return document.activeElement?.closest('.library input') != null;
}

/**
 * Slides the library in when the mouse reaches the left edge of the window, and away again once
 * it leaves. This is only a peek: opening the library with its button or Q keeps it open.
 */
export function useLibraryEdge(): void {
  useEffect(() => {
    let opening = 0;
    let closing = 0;
    let leaving = 0;

    const stop = (timer: number) => {
      window.clearTimeout(timer);
      return 0;
    };
    const slideAway = () => {
      closing = 0;
      const library = useLibrary.getState();
      if (library.peek !== 'in') return;
      library.setPeek('out');
      leaving = window.setTimeout(() => useLibrary.getState().setPeek('off'), LEAVING_MS);
    };
    const closeSoon = () => {
      if (closing) return;
      closing = window.setTimeout(() => {
        if (typingInLibrary()) closing = 0;
        else slideAway();
      }, CLOSE_AFTER_MS);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const { open, peek, setPeek } = useLibrary.getState();
      const atEdge = event.clientX <= EDGE_PX;
      const over = event.target instanceof Element && event.target.closest('.library') !== null;
      if (open) {
        opening = stop(opening);
        closing = stop(closing);
      } else if (peek === 'out' && over) {
        leaving = stop(leaving);
        setPeek('in');
      } else if (peek === 'in') {
        if (atEdge || over) closing = stop(closing);
        else closeSoon();
      } else if (atEdge && event.buttons === 0 && showIsClear()) {
        if (opening) return;
        opening = window.setTimeout(() => {
          opening = 0;
          leaving = stop(leaving);
          setPeek('in');
        }, OPEN_AFTER_MS);
      } else {
        opening = stop(opening);
      }
    };
    const onLeave = () => {
      opening = stop(opening);
      if (useLibrary.getState().peek === 'in') closeSoon();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') slideAway();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('keydown', onKey);
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      stop(opening);
      stop(closing);
      stop(leaving);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey);
      document.documentElement.removeEventListener('mouseleave', onLeave);
    };
  }, []);
}
