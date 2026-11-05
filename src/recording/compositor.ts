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

function draw(source: HTMLCanvasElement, target: Composite): void {
  const crop = cropRect(source.width, source.height, target.aspect);
  const { width, height } = target.canvas;
  target.context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
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
