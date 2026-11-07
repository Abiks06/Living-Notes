import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { PerspectiveCamera } from 'three';
import { useLibrary } from '../library/library';
import { useAppStore } from '../state/appStore';

/** The library's width and margins, as in the stylesheet. */
const LIBRARY_PX = 380 + 2 * 16;
/** The same width at which the rest of the show makes room for it. */
const WIDE_ENOUGH_PX = 900;
const EASE_S = 0.3;

/**
 * Moves the picture into the space beside an open library, so a word spelled across the middle
 * of the window isn't hidden behind it. The camera doesn't move, only where its view lands, so
 * this looks the same from every angle. A recording keeps its own framing.
 */
export function useLibraryRoom(): void {
  const shift = useRef(0);
  const applied = useRef({ shift: 0, width: 0, height: 0 });

  useFrame((state, delta) => {
    const { width, height } = state.size;
    const { lounge, recording, uiHiddenManual } = useAppStore.getState();
    const showing =
      useLibrary.getState().open && !lounge && !uiHiddenManual && recording.state === 'idle';
    const target = showing && width >= WIDE_ENOUGH_PX ? LIBRARY_PX / 2 : 0;
    shift.current += (target - shift.current) * (1 - Math.exp(-Math.min(delta, 0.1) / EASE_S));
    if (Math.abs(target - shift.current) < 0.5) shift.current = target;

    const last = applied.current;
    if (last.shift === shift.current && last.width === width && last.height === height) return;
    applied.current = { shift: shift.current, width, height };
    const camera = state.camera as PerspectiveCamera;
    if (shift.current === 0) camera.clearViewOffset();
    else camera.setViewOffset(width, height, -shift.current, 0, width, height);
  });
}
