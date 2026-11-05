import { DEFAULT_SETTINGS, type Settings } from './schema';

/**
 * Curated looks: a scene plus palette and tuning. Applying one leaves device and
 * personal preferences alone (particle tier, band sensitivity, auto-orbit, your word).
 */
export type LookOverrides = Partial<
  Omit<
    Settings,
    'particles' | 'sensitivity' | 'autoOrbit' | 'autoDirector' | 'customColors' | 'word'
  >
>;

export const LOOKS: readonly { key: string; label: string; settings: LookOverrides }[] = [
  { key: 'aurora-drift', label: 'Aurora Drift', settings: { scene: 'nebula', palette: 'aurora' } },
  {
    key: 'neon-storm',
    label: 'Neon Storm',
    settings: { scene: 'nebula', palette: 'cyber', turbulence: 1.7, curl: 1.35, bloom: 1.3 },
  },
  {
    key: 'solar-terrain',
    label: 'Solar Terrain',
    settings: { scene: 'terrain', palette: 'solar', bloom: 1.25, trails: 0.6 },
  },
  {
    key: 'bio-pulse',
    label: 'Bioluminescent Pulse',
    settings: { scene: 'sphere', palette: 'bio', bloom: 1.2, pointSize: 1.15 },
  },
  {
    key: 'mercury-morph',
    label: 'Mercury Morph',
    settings: { scene: 'morph', palette: 'mercury', aberration: 1.8, trails: 1.15, bloom: 0.85 },
  },
];

/** Everything a look controls, so it can be compared with the current settings. */
const LOOK_KEYS = [
  'scene',
  'palette',
  'bloom',
  'aberration',
  'trails',
  'curl',
  'turbulence',
  'spring',
  'pointSize',
  'dof',
] as const;

/** The curated look these settings exactly match, if any; touching a slider clears it. */
export function activeLook(settings: Settings): string | null {
  for (const look of LOOKS) {
    const target = { ...DEFAULT_SETTINGS, ...look.settings };
    if (LOOK_KEYS.every((key) => settings[key] === target[key])) return look.key;
  }
  return null;
}
