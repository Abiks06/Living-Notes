import type { GpuTimer } from './GpuTimer';

/** WebGL allows one timer query at a time, so the overlay timer stands aside during a run. */
export const benchmarkProbe = {
  busy: false,
  /** Timer the simulation wraps around its compute step while set. */
  stepTimer: null as GpuTimer | null,
};
