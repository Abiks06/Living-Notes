import { useEffect, useState } from 'react';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useAppStore } from '../state/appStore';

const VISIBLE_MS = 9000;

/** One-time tip about orbit / gravity well / zoom; leaves once the visitor tries it. */
export function InteractionHint() {
  const phase = useAppStore((state) => state.phase);
  const interacted = useAppStore((state) => state.interacted);
  const touch = useMediaQuery('(pointer: coarse)');
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (phase !== 'running') return;
    const timer = window.setTimeout(() => setExpired(true), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase !== 'running' || interacted || expired) return null;
  return (
    <p className="interaction-hint" role="status">
      {touch
        ? 'Drag to orbit · Long-press to pull particles · Pinch to zoom'
        : 'Drag to orbit · Hold still or Shift-drag to pull particles · Scroll to zoom'}
    </p>
  );
}
