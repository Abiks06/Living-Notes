import { Vector3 } from 'three';

/**
 * World-space pointer state shared between the input handler (writer) and the particle
 * simulation (reader). Mutated in place every frame, like `audioFeatures`.
 */
export const pointerField = {
  position: new Vector3(),
  velocity: new Vector3(),
  /** 0–1: fades in while the cursor moves over the scene, out when it leaves or rests. */
  hover: 0,
  /** 0–1: eased strength of the held gravity well. */
  gravity: 0,
  /** Impulse that fires when the well is released, decaying to 0. */
  release: 0,
  /** Camera basis, refreshed each frame (also used to billboard the wordmark). */
  cameraDir: new Vector3(0, 0, -1),
  cameraRight: new Vector3(1, 0, 0),
  cameraUp: new Vector3(0, 1, 0),
};

export type PointerField = typeof pointerField;

if (import.meta.env.DEV) Object.assign(window, { __pointer: pointerField });
