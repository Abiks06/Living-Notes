/**
 * Scene presets. Camera targets sit slightly below the subject so it frames above the
 * dock. The numeric `id` is what the simulation shader switches on, so the
 * order here must match the branches in `scenes.glsl.ts`.
 */
export const SCENES = [
  {
    key: 'nebula',
    id: 0,
    label: 'Nebula',
    hint: 'Curl-noise drift · bass churns, beats burst',
    camera: { position: [0, 0.1, 8.6], target: [0, -0.55, 0] },
    post: { trail: 0.82, bloom: 1.1 },
  },
  {
    key: 'sphere',
    id: 1,
    label: 'Sphere Pulse',
    hint: 'Each band moves its own latitude',
    camera: { position: [0, 0.9, 8.3], target: [0, -0.6, 0] },
    post: { trail: 0.55, bloom: 1.0 },
  },
  {
    key: 'terrain',
    id: 2,
    label: 'Terrain',
    hint: 'A landscape made of the scrolling spectrogram',
    camera: { position: [0, 4.2, 7.6], target: [0, -1.1, -0.4] },
    post: { trail: 0.35, bloom: 0.85 },
  },
  {
    key: 'morph',
    id: 3,
    label: 'Morph',
    hint: 'Strong beats morph the cloud into a new shape',
    camera: { position: [0, -0.1, 9.2], target: [0, -0.6, 0] },
    post: { trail: 0.7, bloom: 1.15 },
  },
  {
    key: 'cymatics',
    id: 4,
    label: 'Cymatics',
    hint: 'Sand on a vibrating plate: the pitch sets the pattern',
    camera: { position: [0, 7.2, 4.4], target: [0, -1.3, 0] },
    post: { trail: 0.4, bloom: 0.9 },
  },
] as const;

export type SceneKey = (typeof SCENES)[number]['key'];
export type SceneDefinition = (typeof SCENES)[number];

export const DEFAULT_SCENE: SceneKey = 'nebula';

export function sceneByKey(key: SceneKey): SceneDefinition {
  return SCENES.find((scene) => scene.key === key) ?? SCENES[0];
}

/**
 * Chladni plate modes (n, m), one per pitch class, so the figure changes with the note.
 * Roughly ascending in complexity from C.
 */
export const CHLADNI_MODES: readonly (readonly [number, number])[] = [
  [1, 2],
  [2, 5],
  [1, 3],
  [3, 5],
  [2, 3],
  [1, 4],
  [3, 7],
  [2, 7],
  [1, 5],
  [3, 4],
  [4, 7],
  [5, 6],
];

/** Morph targets; ids match `shapeTarget()` in `shapes.glsl.ts`. */
export const SHAPE = {
  sphere: 0,
  torusKnot: 1,
  helix: 2,
  torus: 3,
  lorenz: 4,
  text: 5,
} as const;

/** Pickable morph shapes, in the order the picker shows them. */
export const MORPH_SHAPES = [
  { key: 'sphere', label: 'Sphere', id: SHAPE.sphere },
  { key: 'knot', label: 'Knot', id: SHAPE.torusKnot },
  { key: 'word', label: 'Word', id: SHAPE.text },
  { key: 'helix', label: 'Helix', id: SHAPE.helix },
  { key: 'torus', label: 'Torus', id: SHAPE.torus },
  { key: 'lorenz', label: 'Lorenz', id: SHAPE.lorenz },
] as const;

export type MorphShapeKey = (typeof MORPH_SHAPES)[number]['key'];

/** Spec order first (sphere → torus knot → text), then the extended set. */
export const MORPH_SEQUENCE: readonly number[] = [
  SHAPE.sphere,
  SHAPE.torusKnot,
  SHAPE.text,
  SHAPE.helix,
  SHAPE.torus,
  SHAPE.lorenz,
];
