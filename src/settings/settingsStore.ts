import { create } from 'zustand';
import { LOOKS } from './looks';
import type { PaletteColors } from './palettes';
import {
  DEFAULT_SETTINGS,
  NUMERIC,
  type NumericKey,
  quantize,
  SENSITIVITY,
  type Settings,
} from './schema';

interface SettingsActions {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setNumeric: (key: NumericKey, value: number) => void;
  setSensitivity: (band: number, value: number) => void;
  setCustomColor: (index: number, hex: string) => void;
  /** Replace everything (used when a share link is opened). */
  replace: (settings: Settings) => void;
  applyLook: (key: string) => void;
  reset: () => void;
}

export const useSettings = create<Settings & SettingsActions>()((set) => ({
  ...DEFAULT_SETTINGS,
  set: (key, value) => set({ [key]: value } as Pick<Settings, typeof key>),
  setNumeric: (key, value) => set({ [key]: quantize(value, NUMERIC[key]) }),
  setSensitivity: (band, value) =>
    set((state) => {
      const sensitivity = [...state.sensitivity];
      sensitivity[band] = quantize(value, SENSITIVITY);
      return { sensitivity };
    }),
  setCustomColor: (index, hex) =>
    set((state) => {
      const colors = [...state.customColors] as [string, string, string, string];
      colors[index] = hex;
      return { customColors: colors as PaletteColors, palette: 'custom' };
    }),
  replace: (settings) => set(settings),
  applyLook: (key) =>
    set((state) => {
      const look = LOOKS.find((l) => l.key === key);
      if (!look) return {};
      // Reset the look's dimensions to defaults first so looks don't stack on each other.
      return {
        ...DEFAULT_SETTINGS,
        particles: state.particles,
        sensitivity: state.sensitivity,
        autoOrbit: state.autoOrbit,
        autoDirector: state.autoDirector,
        customColors: state.customColors,
        word: state.word,
        ...look.settings,
      };
    }),
  reset: () => set(DEFAULT_SETTINGS),
}));

/** The plain settings, without the action functions. */
export function readSettings(): Settings {
  const s = useSettings.getState();
  return {
    scene: s.scene,
    morphShape: s.morphShape,
    word: s.word,
    palette: s.palette,
    customColors: s.customColors,
    particles: s.particles,
    autoOrbit: s.autoOrbit,
    autoDirector: s.autoDirector,
    sensitivity: s.sensitivity,
    bloom: s.bloom,
    aberration: s.aberration,
    trails: s.trails,
    curl: s.curl,
    turbulence: s.turbulence,
    spring: s.spring,
    pointSize: s.pointSize,
    dof: s.dof,
  };
}
