import { useEffect, useRef } from 'react';
import { audioEngine } from '../audio/AudioEngine';
import { audioFeatures, SPECTRUM_MAX_BIN } from '../audio/features';
import { useMediaQuery, useReducedMotion } from '../lib/useMediaQuery';
import { paletteColors } from '../settings/palettes';
import { useSettings } from '../settings/settingsStore';

const BARS = 72;
const MIN_BIN = 1;
const MAX_BIN = SPECTRUM_MAX_BIN;
const FALL_PER_S = 1.6;
const BRAND_STOPS = ['#7b5cff', '#39b8ff', '#ff6fd8'] as const;

/** Log-spaced bin ranges, so each bar covers an equal slice of musical pitch. */
function buildBarBins(): Uint16Array {
  const edges = new Uint16Array(BARS + 1);
  for (let i = 0; i <= BARS; i++) {
    const bin = MIN_BIN * (MAX_BIN / MIN_BIN) ** (i / BARS);
    edges[i] = Math.max(i === 0 ? MIN_BIN : (edges[i - 1] ?? 0) + 1, Math.round(bin));
  }
  return edges;
}

/** Compact live spectrum on a 2D canvas, redrawn on the engine's frame tick (no React renders). */
export function SpectrumStrip() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useReducedMotion();
  const lightScheme = useMediaQuery('(prefers-color-scheme: light)');
  const palette = useSettings((state) => state.palette);
  const custom = useSettings((state) => state.customColors);
  // On the light panel, pale palettes (Mercury) would vanish; keep the brand gradient there.
  const colors = paletteColors(palette, custom);
  const [stopA, stopB, stopC] = lightScheme ? BRAND_STOPS : [colors[1], colors[2], colors[3]];

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const edges = buildBarBins();
    const levels = new Float32Array(BARS);
    let gradient: CanvasGradient | null = null;
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, stopA);
      gradient.addColorStop(0.55, stopB);
      gradient.addColorStop(1, stopC);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = (dt: number) => {
      const spectrum = audioFeatures.spectrum;
      const gap = 2;
      const barWidth = Math.max(1, (width - gap * (BARS - 1)) / BARS);

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = gradient ?? '#7b5cff';
      ctx.globalAlpha = 0.55 + (reducedMotion ? 0 : audioFeatures.beat * 0.45);

      for (let i = 0; i < BARS; i++) {
        let peak = 0;
        const end = edges[i + 1] ?? MAX_BIN;
        for (let bin = edges[i] ?? MIN_BIN; bin < end; bin++) {
          const value = spectrum[bin] ?? 0;
          if (value > peak) peak = value;
        }
        const target = peak / 255;
        const current = levels[i] ?? 0;
        const level = target > current ? target : Math.max(target, current - FALL_PER_S * dt);
        levels[i] = level;

        const barHeight = Math.max(1.5, level * level * height);
        ctx.fillRect(i * (barWidth + gap), height - barHeight, barWidth, barHeight);
      }
      ctx.globalAlpha = 1;
    };
    const unsubscribe = audioEngine.onFrame(draw);

    return () => {
      unsubscribe();
      observer.disconnect();
    };
  }, [reducedMotion, stopA, stopB, stopC]);

  return <canvas ref={canvasRef} className="spectrum" aria-hidden="true" />;
}
