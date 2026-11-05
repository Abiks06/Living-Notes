interface TimerQueryExt {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

const MAX_IN_FLIGHT = 4;

/**
 * Whole-frame GPU time via EXT_disjoint_timer_query_webgl2 (Chromium desktop; absent in
 * Firefox and Safari). Results arrive a few frames late, so queries are kept in flight
 * and polled; a "disjoint" event (GPU reset, power-state change) discards them.
 */
export class GpuTimer {
  readonly supported: boolean;
  /** Smoothed milliseconds, or null until the first result. */
  ms: number | null = null;
  /** How many results have arrived. */
  samples = 0;

  private readonly ext: TimerQueryExt | null;
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  private readonly gl: WebGL2RenderingContext;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null;
    this.supported = this.ext !== null;
  }

  begin(): void {
    if (!this.ext || this.active || this.pending.length >= MAX_IN_FLIGHT) return;
    const query = this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = query;
  }

  end(): void {
    if (!this.ext) return;
    if (this.active) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.pending.push(this.active);
      this.active = null;
    }
    // Poll even when begin() declined: with the queue full nothing else would ever drain it.
    this.poll();
  }

  private poll(): void {
    const gl = this.gl;
    const disjoint = this.ext ? Boolean(gl.getParameter(this.ext.GPU_DISJOINT_EXT)) : false;
    while (this.pending.length > 0) {
      const query = this.pending[0];
      if (!query) break;
      if (!disjoint && !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) {
        const ms = Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6;
        this.ms = this.ms === null ? ms : this.ms + (ms - this.ms) * 0.15;
        this.samples++;
      }
      gl.deleteQuery(query);
    }
  }

  dispose(): void {
    if (this.active && this.ext) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    for (const query of this.pending) this.gl.deleteQuery(query);
    this.pending.length = 0;
    this.active = null;
  }
}
