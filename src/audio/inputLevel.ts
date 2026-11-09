/** Where a modern master sits, in dBFS of short-term loudness. Analysis was tuned on these. */
const TARGET_DB = -14;
/** Never turned down, and never up past this: beyond it, it's noise being amplified. */
const MAX_GAIN_DB = 30;
/** Quieter than this is a pause or a gap between songs, which says nothing about level. */
const LISTEN_ABOVE_DB = -62;
/** The loud parts set the level, remembered through quiet ones so a verse isn't pumped up. */
const PEAK_FALL_DB_PER_S = 0.4;
/** Fast enough to settle within a couple of seconds of a song starting. */
const RISE_S = 0.6;
const FALL_S = 0.25;

/**
 * Brings a live source up to the level a music file plays at, for analysis only. A streaming
 * app sends everything out normalised and then turned down by its own volume slider, often
 * 15 to 30 dB under a file, and the analysers measure on a fixed decibel scale: the quiet copy
 * of a song moves every band a fraction as far. Nothing here reaches the speakers.
 */
export class InputLeveller {
  private loudDb = -120;
  private heard = false;

  /**
   * @param samples The latest stretch of sound, after the current gain.
   * @param gain The gain those samples were heard through.
   * @returns The gain to use next.
   */
  update(samples: Float32Array, gain: number, dt: number): number {
    let power = 0;
    for (let i = 0; i < samples.length; i++) power += (samples[i] ?? 0) ** 2;
    const rms = Math.sqrt(power / Math.max(1, samples.length)) / Math.max(gain, 1e-6);
    const db = rms > 1e-7 ? 20 * Math.log10(rms) : -140;
    if (db < LISTEN_ABOVE_DB) return gain;

    // The first real sound sets the level at once, rather than creeping up to it.
    this.loudDb = this.heard ? Math.max(db, this.loudDb - PEAK_FALL_DB_PER_S * dt) : db;
    this.heard = true;
    const wantedDb = Math.min(MAX_GAIN_DB, Math.max(0, TARGET_DB - this.loudDb));
    const wanted = 10 ** (wantedDb / 20);
    const tau = wanted > gain ? RISE_S : FALL_S;
    return gain + (wanted - gain) * (1 - Math.exp(-dt / tau));
  }

  reset(): void {
    this.loudDb = -120;
    this.heard = false;
  }
}
