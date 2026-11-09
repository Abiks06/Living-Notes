import { clamp01 } from './envelope';
import { AMPLITUDE } from './tone';

/** C3 to C6: where sung and played lead lines sit. Below it is bass, which isn't a tune. */
const LOW_NOTE = 48;
const HIGH_NOTE = 84;
const NOTES = HIGH_NOTE - LOW_NOTE + 1;
const HARMONICS = 5;
/** Each harmonic counts for less, which is what keeps the octave below from winning. */
const HARMONIC_FALL = 0.8;
/** How far the leading note has to be beaten before the line jumps to another. */
const SWITCH_MARGIN = 1.18;
/** A note close to the last one is likelier than a leap, as tunes mostly move by step. */
const NEAR_BONUS = 0.25;
const NEAR_SEMITONES = 4;
/**
 * How far the best note stands above the rest before it counts as a line at all. Measured on
 * real songs, a clear line runs 3 to 8 times the average note, sung or played alike.
 */
const CLEAR_FROM = 2;
const CLEAR_RANGE = 4;
const LEVEL_ATTACK_S = 0.05;
const LEVEL_RELEASE_S = 0.3;

/**
 * Follows the lead line in live sound, octave and all. A pitch class alone can't say whether a
 * tune went up or down, so each note in range is scored by its own harmonics stacked together,
 * which a sung or played note has and a drum doesn't. It's a rough reading of a full mix, good
 * for the shape of a melody rather than its every note.
 */
export class LiveMelody {
  /** The note being heard, as a MIDI number. */
  note = (LOW_NOTE + HIGH_NOTE) / 2;
  /** 0-1: how clearly one line stands out. */
  level = 0;

  private readonly from: Int16Array;
  private readonly to: Int16Array;
  private readonly weight: Float32Array;
  private readonly salience = new Float32Array(NOTES);
  /** How many times stronger the note is than the average note in range. */
  clarity = 0;
  private current = -1;

  constructor(sampleRate: number, fftSize: number) {
    const hzPerBin = sampleRate / fftSize;
    const bins = fftSize / 2;
    this.from = new Int16Array(NOTES * HARMONICS);
    this.to = new Int16Array(NOTES * HARMONICS);
    this.weight = new Float32Array(NOTES * HARMONICS);
    for (let n = 0; n < NOTES; n++) {
      const f0 = 440 * 2 ** ((LOW_NOTE + n - 69) / 12);
      for (let h = 0; h < HARMONICS; h++) {
        const hz = f0 * (h + 1);
        const centre = Math.round(hz / hzPerBin);
        // A third of a semitone either side, so a voice a little off pitch still counts.
        const reach = Math.min(3, Math.floor((hz * 0.02) / hzPerBin));
        const slot = n * HARMONICS + h;
        const inRange = centre + reach < bins;
        this.from[slot] = inRange ? centre - reach : 0;
        this.to[slot] = inRange ? centre + reach : -1;
        // Music is far louder low down, so higher partials are lifted to be heard at all.
        this.weight[slot] = HARMONIC_FALL ** h * Math.sqrt(hz / 440);
      }
    }
  }

  update(spectrum: Uint8Array, dt: number, active: boolean): void {
    if (!active) {
      this.level *= Math.exp(-dt / LEVEL_RELEASE_S);
      return;
    }
    const salience = this.salience;
    let total = 0;
    let best = 0;
    let bestScore = 0;
    for (let n = 0; n < NOTES; n++) {
      let sum = 0;
      // A real note has its first partials. Without them this is someone else's overtone.
      let low = 0;
      for (let h = 0; h < HARMONICS; h++) {
        const slot = n * HARMONICS + h;
        let peak = 0;
        for (let bin = this.from[slot] ?? 0; bin <= (this.to[slot] ?? -1); bin++) {
          const amplitude = AMPLITUDE[spectrum[bin] ?? 0] ?? 0;
          if (amplitude > peak) peak = amplitude;
        }
        const part = peak * (this.weight[slot] ?? 0);
        sum += part;
        if (h < 2) low += part;
      }
      const value = low > sum * 0.3 ? sum : sum * 0.5;
      salience[n] = value;
      total += value;
      const near =
        this.current >= 0 ? NEAR_BONUS * Math.exp(-Math.abs(n - this.current) / NEAR_SEMITONES) : 0;
      const score = value * (1 + near);
      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    }
    if (total <= 0) return;

    const held = this.current >= 0 ? (salience[this.current] ?? 0) : 0;
    if (this.current < 0 || (salience[best] ?? 0) > held * SWITCH_MARGIN) this.current = best;
    this.note = LOW_NOTE + this.current;

    const clear = (salience[this.current] ?? 0) / (total / NOTES);
    this.clarity = clear;
    const target = clamp01((clear - CLEAR_FROM) / CLEAR_RANGE);
    const tau = target > this.level ? LEVEL_ATTACK_S : LEVEL_RELEASE_S;
    this.level += (target - this.level) * (1 - Math.exp(-dt / tau));
  }

  reset(): void {
    this.current = -1;
    this.level = 0;
  }
}
