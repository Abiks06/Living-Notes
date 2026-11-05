/** Rolling numbers written by the in-canvas monitor and read by the HTML overlay. */
export const perfStats = {
  fps: 0,
  frameMs: 0,
  /** Whole-frame GPU time from a timer query, or null where the browser doesn't expose one. */
  gpuMs: null as number | null,
  dpr: 1,
};
