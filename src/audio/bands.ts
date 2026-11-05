/** Frequency bands, in the order they appear in `AudioFeatures.bands`. */
export const BANDS = [
  { key: 'subBass', label: 'Sub', minHz: 20, maxHz: 60 },
  { key: 'bass', label: 'Bass', minHz: 60, maxHz: 250 },
  { key: 'lowMid', label: 'Low mid', minHz: 250, maxHz: 500 },
  { key: 'mid', label: 'Mid', minHz: 500, maxHz: 2000 },
  { key: 'highMid', label: 'High mid', minHz: 2000, maxHz: 4000 },
  { key: 'treble', label: 'Treble', minHz: 4000, maxHz: 16000 },
] as const;

export type BandKey = (typeof BANDS)[number]['key'];

export const BAND_COUNT = BANDS.length;

/** Index of each band inside the `bands` Float32Array. */
export const BAND = {
  subBass: 0,
  bass: 1,
  lowMid: 2,
  mid: 3,
  highMid: 4,
  treble: 5,
} as const satisfies Record<BandKey, number>;

export const NO_BAND = 255;

/**
 * Maps every FFT bin to the band it belongs to (or NO_BAND), plus per-band bin counts.
 * Built once per sample rate so the per-frame loop is a single pass over the spectrum.
 */
export interface BandLayout {
  readonly binToBand: Uint8Array;
  readonly binCounts: Uint16Array;
}

export function createBandLayout(sampleRate: number, fftSize: number): BandLayout {
  const binCount = fftSize / 2;
  const hzPerBin = sampleRate / fftSize;
  const binToBand = new Uint8Array(binCount).fill(NO_BAND);
  const binCounts = new Uint16Array(BAND_COUNT);

  BANDS.forEach((band, bandIndex) => {
    // Bin 0 is DC; always skip it. Guarantee at least one bin per band even at low resolution.
    const start = Math.max(1, Math.floor(band.minHz / hzPerBin));
    const end = Math.min(binCount, Math.max(start + 1, Math.ceil(band.maxHz / hzPerBin)));
    for (let bin = start; bin < end; bin++) {
      if (binToBand[bin] === NO_BAND) {
        binToBand[bin] = bandIndex;
        binCounts[bandIndex] = (binCounts[bandIndex] ?? 0) + 1;
      }
    }
  });

  return { binToBand, binCounts };
}
