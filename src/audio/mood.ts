const WINDOW_S = 4;
/** A label has to hold this long before it replaces the current one. */
const VIBE_HOLD_S = 2.5;
/** Most music's energy sits low, so a bright mix measures well under the halfway mark. */
const BRIGHT = 0.33;
/** Onsets per second that read as fully busy. */
const BUSY_ONSETS = 5;
const SLOW_BPM = 70;
const FAST_BPM = 150;

export const VIBES = [
  'Listening',
  'High energy',
  'Heavy groove',
  'Warm groove',
  'Melodic drift',
  'Deep calm',
] as const;

export type Vibe = (typeof VIBES)[number];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** The label for a point on the mood compass. */
export function vibeOf(arousal: number, brightness: number, melodic: number): Vibe {
  if (arousal >= 0.62) return brightness >= BRIGHT ? 'High energy' : 'Heavy groove';
  if (arousal >= 0.38) return melodic >= 0.3 ? 'Melodic drift' : 'Warm groove';
  return melodic >= 0.2 ? 'Melodic drift' : 'Deep calm';
}

export interface MoodInput {
  gate: number;
  intensity: number;
  centroid: number;
  vocal: number;
  bpm: number;
  locked: boolean;
  onset: boolean;
}

/**
 * Where the music sits on two slow axes, averaged over a few seconds so the room's colour
 * follows the song and not the snare: arousal (calm to intense) and brightness (dark to
 * bright). It describes timbre and drive, not emotion: minor-key joy and major-key sorrow
 * look the same to it.
 */
export class MoodTracker {
  arousal = 0;
  brightness = 0.5;
  /** Index into `VIBES`. */
  vibe = 0;

  private onsetRate = 0;
  private melodic = 0;
  private candidate = 0;
  private candidateHeld = 0;

  update(dt: number, input: MoodInput): void {
    const ease = 1 - Math.exp(-dt / WINDOW_S);
    this.onsetRate += ((input.onset ? 1 / Math.max(dt, 1e-3) : 0) - this.onsetRate) * ease;
    if (input.gate < 0.3) {
      this.arousal -= this.arousal * ease;
      this.melodic -= this.melodic * ease;
      this.settle(dt, 0);
      return;
    }

    const pace = input.locked ? clamp01((input.bpm - SLOW_BPM) / (FAST_BPM - SLOW_BPM)) : 0.2;
    const drive =
      0.45 * input.intensity + 0.3 * clamp01(this.onsetRate / BUSY_ONSETS) + 0.25 * pace;
    this.arousal += (drive - this.arousal) * ease;
    this.brightness += (input.centroid - this.brightness) * ease;
    this.melodic += (input.vocal - this.melodic) * ease;

    const label = vibeOf(this.arousal, this.brightness, this.melodic);
    this.settle(dt, VIBES.indexOf(label));
  }

  reset(): void {
    this.arousal = 0;
    this.brightness = 0.5;
    this.vibe = 0;
    this.onsetRate = 0;
    this.melodic = 0;
    this.candidate = 0;
    this.candidateHeld = 0;
  }

  private settle(dt: number, next: number): void {
    if (next !== this.candidate) {
      this.candidate = next;
      this.candidateHeld = 0;
    }
    this.candidateHeld += dt;
    if (this.candidateHeld >= VIBE_HOLD_S) this.vibe = next;
  }
}
