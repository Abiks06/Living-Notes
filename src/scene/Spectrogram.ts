import {
  DataTexture,
  LinearFilter,
  RedFormat,
  RepeatWrapping,
  ClampToEdgeWrapping,
  UnsignedByteType,
} from 'three';
import { SPECTRUM_MAX_BIN } from '../audio/features';

export const SPECTROGRAM_BINS = 128;
export const SPECTROGRAM_ROWS = 128;
/** Fixed scroll rate, independent of display refresh (60 Hz and 144 Hz look the same). */
const ROWS_PER_SECOND = 40;
const MIN_BIN = 2;

/**
 * Scrolling spectrogram for the Terrain scene: a ring buffer of log-frequency rows in an
 * R8 texture. Writing one row per tick and advancing a head offset means history is never
 * copied; the shader adds the offset when sampling (the texture wraps vertically).
 */
export class Spectrogram {
  readonly texture: DataTexture;
  /** Ring position in 0–1 including the fractional progress toward the next row. */
  head = 0;

  private readonly data = new Uint8Array(SPECTROGRAM_BINS * SPECTROGRAM_ROWS);
  private readonly edges = new Uint16Array(SPECTROGRAM_BINS + 1);
  private row = 0;
  private accumulator = 0;

  constructor() {
    for (let i = 0; i <= SPECTROGRAM_BINS; i++) {
      const bin = MIN_BIN * (SPECTRUM_MAX_BIN / MIN_BIN) ** (i / SPECTROGRAM_BINS);
      this.edges[i] = Math.max(i === 0 ? MIN_BIN : (this.edges[i - 1] ?? 0) + 1, Math.round(bin));
    }
    this.texture = new DataTexture(
      this.data,
      SPECTROGRAM_BINS,
      SPECTROGRAM_ROWS,
      RedFormat,
      UnsignedByteType,
    );
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = RepeatWrapping;
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearFilter;
    this.texture.needsUpdate = true;
  }

  update(dt: number, spectrum: Uint8Array): void {
    this.accumulator += dt * ROWS_PER_SECOND;
    if (this.accumulator >= 1) {
      this.accumulator = Math.min(this.accumulator - 1, 1);
      this.writeRow(spectrum);
    }
    this.head = (this.row + this.accumulator) / SPECTROGRAM_ROWS;
  }

  private writeRow(spectrum: Uint8Array): void {
    const offset = this.row * SPECTROGRAM_BINS;
    for (let i = 0; i < SPECTROGRAM_BINS; i++) {
      let peak = 0;
      const end = this.edges[i + 1] ?? SPECTRUM_MAX_BIN;
      for (let bin = this.edges[i] ?? MIN_BIN; bin < end; bin++) {
        const value = spectrum[bin] ?? 0;
        if (value > peak) peak = value;
      }
      this.data[offset + i] = peak;
    }
    this.row = (this.row + 1) % SPECTROGRAM_ROWS;
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
