export const CAPTURE_ASPECTS = ['window', '16:9', '9:16', '1:1'] as const;
export type CaptureAspect = (typeof CAPTURE_ASPECTS)[number];

export const CLIP_LENGTHS = [10, 15, 30] as const;
export type ClipLength = (typeof CLIP_LENGTHS)[number];

const RATIO: Record<Exclude<CaptureAspect, 'window'>, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
};

/** Standard upload sizes; drawImage scales the crop to these. */
const OUTPUT: Record<Exclude<CaptureAspect, 'window'>, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 720, height: 1280 },
  '1:1': { width: 1080, height: 1080 },
};

/** Same aspect ratio below which the camera rig backs off for narrow frames. */
const CAMERA_FIT_ASPECT = 0.8;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function aspectRatio(aspect: CaptureAspect, windowRatio: number): number {
  return aspect === 'window' ? windowRatio : RATIO[aspect];
}

/** The largest centred rectangle of the source with the requested aspect ratio. */
export function cropRect(sourceWidth: number, sourceHeight: number, aspect: CaptureAspect): Rect {
  const ratio = aspectRatio(aspect, sourceWidth / sourceHeight);
  const width = Math.min(sourceWidth, sourceHeight * ratio);
  const height = width / ratio;
  return { x: (sourceWidth - width) / 2, y: (sourceHeight - height) / 2, width, height };
}

/** Video encoders need even dimensions. */
function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

export function outputSize(crop: Rect, aspect: CaptureAspect): { width: number; height: number } {
  return aspect === 'window'
    ? { width: even(crop.width), height: even(crop.height) }
    : OUTPUT[aspect];
}

/**
 * How far to pull the camera back so a scene framed for the window also fits the crop.
 * Never less than 1: a wider crop keeps the camera where it is.
 */
export function framingFactor(windowRatio: number, aspect: CaptureAspect): number {
  const fit = (ratio: number) => Math.max(1, CAMERA_FIT_ASPECT / ratio);
  return Math.max(1, fit(aspectRatio(aspect, windowRatio)) / fit(windowRatio));
}
