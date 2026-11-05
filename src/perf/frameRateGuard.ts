/** Sustained-FPS detector for adaptive quality. Pure logic; the caller supplies frame times. */

export const WINDOW_S = 3;
/** A frame this long is a stall (tab hidden, throttled, debugger) — not evidence of slowness. */
export const STALL_S = 0.1;
/** After a quality change, give rebuilds and shader compiles time to settle. */
export const COOLDOWN_S = 4;

export class FrameRateGuard {
  private frames = 0;
  private elapsed = 0;
  private cooldown = COOLDOWN_S;

  /** Feed one frame; returns the average FPS each time a full window completes. */
  push(dt: number): number | null {
    if (this.cooldown > 0) {
      this.cooldown -= Math.min(dt, STALL_S);
      return null;
    }
    if (dt > STALL_S) {
      this.reset();
      return null;
    }
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed < WINDOW_S) return null;

    const fps = this.frames / this.elapsed;
    this.reset();
    return fps;
  }

  /** Call after acting on a low-FPS signal (or when measuring shouldn't count). */
  holdOff(): void {
    this.reset();
    this.cooldown = COOLDOWN_S;
  }

  private reset(): void {
    this.frames = 0;
    this.elapsed = 0;
  }
}
