import { useFrame } from '@react-three/fiber';
import { useEffect } from 'react';
import { audioEngine } from '../audio/AudioEngine';

/** Negative priority: runs before every other useFrame and doesn't take over rendering. */
const BEFORE_EVERYTHING = -1;

/**
 * Drives audio analysis from the R3F render loop, so the particles always read
 * features computed in the same frame. One rAF per vsync for the whole app.
 */
export function AudioClock() {
  useEffect(() => audioEngine.attachClock(), []);
  useFrame((_, delta) => audioEngine.tick(delta), BEFORE_EVERYTHING);
  return null;
}
