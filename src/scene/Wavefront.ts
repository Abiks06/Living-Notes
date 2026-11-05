import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';
import type { AudioFeatures } from '../audio/features';

export const WAVE_ROWS = 64;
const ROWS_PER_SECOND = 60;

/**
 * The last second of the music as a texture: push, snare, kick light and sub-bass per row.
 * Sampling it further back the further a particle is from the core turns one instant into a
 * wave travelling outward, so a hit visibly starts somewhere and goes somewhere.
 */
export class Wavefront {
  readonly texture: DataTexture;
  /** The newest row. */
  head = 0;

  private readonly data = new Float32Array(WAVE_ROWS * 4);
  private owed = 0;

  constructor() {
    this.texture = new DataTexture(this.data, WAVE_ROWS, 1, RGBAFormat, FloatType);
    this.texture.minFilter = NearestFilter;
    this.texture.magFilter = NearestFilter;
    this.texture.needsUpdate = true;
  }

  update(dt: number, audio: AudioFeatures): void {
    this.owed = Math.min(this.owed + dt * ROWS_PER_SECOND, WAVE_ROWS);
    if (this.owed < 1) return;
    while (this.owed >= 1) {
      this.owed -= 1;
      this.head = (this.head + 1) % WAVE_ROWS;
      const row = this.head * 4;
      this.data[row] = audio.push;
      this.data[row + 1] = audio.snare;
      this.data[row + 2] = audio.kick;
      this.data[row + 3] = audio.bands[0] ?? 0;
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
