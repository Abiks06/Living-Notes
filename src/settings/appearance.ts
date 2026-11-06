import { create } from 'zustand';

export const APPEARANCES = [
  { key: 'aura', label: 'Aura', hint: 'Takes its colours from the song' },
  { key: 'midnight', label: 'Midnight', hint: 'Quiet and neutral' },
  { key: 'ember', label: 'Ember', hint: 'A warm listening room' },
  { key: 'paper', label: 'Paper', hint: 'The music in ink, on paper' },
] as const;

export type Appearance = (typeof APPEARANCES)[number]['key'];

const STORAGE_KEY = 'resonance.appearance';

function isAppearance(value: string | null): value is Appearance {
  return APPEARANCES.some((appearance) => appearance.key === value);
}

/** Someone who asks their system for light gets the light one, until they choose. */
function initial(): Appearance {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isAppearance(saved)) return saved;
  } catch {
    // Storage blocked: the system preference still counts.
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'paper' : 'aura';
}

function apply(appearance: Appearance): void {
  document.documentElement.dataset['appearance'] = appearance;
}

interface AppearanceState {
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
}

export const useAppearance = create<AppearanceState>()((set) => ({
  appearance: initial(),
  setAppearance: (appearance) => {
    apply(appearance);
    set({ appearance });
    try {
      window.localStorage.setItem(STORAGE_KEY, appearance);
    } catch {
      // It still applies for this visit.
    }
  },
}));

export function initAppearance(): void {
  apply(useAppearance.getState().appearance);
}

export function nextAppearance(current: Appearance): Appearance {
  const index = APPEARANCES.findIndex((appearance) => appearance.key === current);
  return APPEARANCES[(index + 1) % APPEARANCES.length]?.key ?? 'aura';
}
