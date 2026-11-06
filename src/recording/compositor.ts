import { wrapText } from './wrapText';
import { useAppearance } from '../settings/appearance';
import { useLibrary } from '../library/library';
import { type CaptureAspect, cropRect, outputSize } from './framing';

const SNAPSHOT_TIMEOUT_MS = 2000;

interface Composite {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly aspect: CaptureAspect;
}

interface Snapshot {
  readonly aspect: CaptureAspect;
  resolve(blob: Blob): void;
  reject(reason: Error): void;
}

let composite: Composite | null = null;
let snapshot: Snapshot | null = null;

/** Clips get shared without any context, so they carry the song's name themselves. */
function drawCaption(target: Composite): void {
  const song = useLibrary.getState().nowPlaying;
  if (!song) return;
  const { context, canvas } = target;
  const unit = Math.min(canvas.width, canvas.height) / 100;
  const x = unit * 5;
  const y = unit * 8;
  context.save();
  context.textBaseline = 'alphabetic';
  const paper = useAppearance.getState().appearance === 'paper';
  context.shadowColor = paper ? 'rgba(244, 239, 228, 0.8)' : 'rgba(0, 0, 0, 0.6)';
  context.shadowBlur = unit * 1.5;
  context.fillStyle = paper ? '#1d1a16' : '#ffffff';
  const width = canvas.width - x * 2;
  const measure = (line: string) => context.measureText(line).width;
  context.font = `700 ${unit * 4.2}px Inter, system-ui, sans-serif`;
  let line = y;
  for (const part of wrapText(song.title, width, measure)) {
    context.fillText(part, x, line);
    line += unit * 5;
  }
  context.globalAlpha = 0.8;
  context.font = `500 ${unit * 2.8}px Inter, system-ui, sans-serif`;
  line -= unit;
  for (const part of wrapText(song.artist, width, measure)) {
    context.fillText(part, x, line);
    line += unit * 3.4;
  }
  context.restore();
}

function draw(source: HTMLCanvasElement, target: Composite): void {
  const crop = cropRect(source.width, source.height, target.aspect);
  const { width, height } = target.canvas;
  target.context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  drawCaption(target);
}

function createComposite(source: HTMLCanvasElement, aspect: CaptureAspect): Composite | null {
  const canvas = document.createElement('canvas');
  const size = outputSize(cropRect(source.width, source.height, aspect), aspect);
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { alpha: false });
  return context ? { canvas, context, aspect } : null;
}

/** Starts copying each rendered frame into a cropped canvas, and returns it for recording. */
export function startComposite(
  source: HTMLCanvasElement,
  aspect: CaptureAspect,
): HTMLCanvasElement {
  composite = createComposite(source, aspect);
  if (!composite) throw new Error('2D canvas unavailable');
  return composite.canvas;
}

export function stopComposite(): void {
  composite = null;
}

/** Resolves with a PNG of the next rendered frame, cropped to the aspect. */
export function requestSnapshot(aspect: CaptureAspect): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const pending: Snapshot = { aspect, resolve, reject };
    snapshot = pending;
    window.setTimeout(() => {
      if (snapshot !== pending) return;
      snapshot = null;
      reject(new Error('No frame was rendered'));
    }, SNAPSHOT_TIMEOUT_MS);
  });
}

/**
 * Runs straight after the frame is drawn. The WebGL drawing buffer is only guaranteed
 * until control returns to the browser (no preserveDrawingBuffer, which would cost
 * performance on every frame), so copies have to happen in this same callback.
 */
export function afterRender(source: HTMLCanvasElement): void {
  if (composite) draw(source, composite);

  const pending = snapshot;
  if (!pending) return;
  snapshot = null;
  const target = createComposite(source, pending.aspect);
  if (!target) {
    pending.reject(new Error('2D canvas unavailable'));
    return;
  }
  draw(source, target);
  target.canvas.toBlob((blob) => {
    if (blob) pending.resolve(blob);
    else pending.reject(new Error('The browser could not encode the image'));
  }, 'image/png');
}
