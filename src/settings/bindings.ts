import { Color } from 'three';
import { audioEngine } from '../audio/AudioEngine';
import { paletteColors } from './palettes';
import type { Settings } from './schema';
import { useSettings } from './settingsStore';

/**
 * The parts of the look the render loop reads every frame, kept as plain mutable values
 * so the loop never touches the store or allocates. Updated only when settings change.
 */
export const liveLook = {
  curl: 1,
  turbulence: 1,
  spring: 1,
  pointSize: 1,
  dof: 1,
  bloom: 1,
  aberration: 1,
  trails: 1,
  /** Target palette; the renderer eases toward it so palette switches never snap. */
  palette: [new Color(), new Color(), new Color(), new Color()] as const,
};

export type LiveLook = typeof liveLook;

function apply(settings: Settings): void {
  liveLook.curl = settings.curl;
  liveLook.turbulence = settings.turbulence;
  liveLook.spring = settings.spring;
  liveLook.pointSize = settings.pointSize;
  liveLook.dof = settings.dof;
  liveLook.bloom = settings.bloom;
  liveLook.aberration = settings.aberration;
  liveLook.trails = settings.trails;
  paletteColors(settings.palette, settings.customColors).forEach((hex, i) => {
    liveLook.palette[i]?.set(hex);
  });
  settings.sensitivity.forEach((value, band) => {
    audioEngine.sensitivity[band] = value;
  });
}

/** Push settings into the audio engine and the render loop now and on every change. */
export function bindSettings(): () => void {
  apply(useSettings.getState());
  return useSettings.subscribe(apply);
}
