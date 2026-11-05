import type { WebGLRenderer } from 'three';

export type WebGLSupport = { ok: true } | { ok: false; reason: string };

let cached: WebGLSupport | null = null;

/** Probes for WebGL2 once, without keeping the probe context alive. */
export function detectWebGL2(): WebGLSupport {
  if (cached) return cached;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) {
      cached = { ok: false, reason: 'WebGL2 is not available in this browser or is disabled.' };
    } else {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      cached = { ok: true };
    }
  } catch {
    cached = { ok: false, reason: 'WebGL2 could not be initialised.' };
  }
  return cached;
}

/** Stable GPU name, used to key the remembered particle tier. */
export function describeGpu(gl: WebGLRenderer): string {
  const ctx = gl.getContext();
  const info = ctx.getExtension('WEBGL_debug_renderer_info');
  return String(ctx.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : ctx.RENDERER));
}
