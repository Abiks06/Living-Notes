import type { AudioFeatures } from '../audio/features';

export interface PartLook {
  /** Turn of the whole picture's colour, as a fraction of the hue circle. */
  readonly hue: number;
  /** Multiplies how tightly the particles swirl, and how wildly. */
  readonly curl: number;
  readonly turbulence: number;
  /** Which way, and how fast, the form turns. */
  readonly spin: number;
  /** Multiplies the lens width. */
  readonly lens: number;
}

/**
 * One look per part of a song, the part it spends longest in first, so that it keeps the look
 * chosen for the song. Each is different in several ways at once: a chorus should be recognised
 * by how it feels coming back, and colour alone is easy to miss.
 */
const LOOKS: readonly PartLook[] = [
  { hue: 0, curl: 1, turbulence: 1, spin: 1, lens: 1 },
  { hue: 0.13, curl: 1.4, turbulence: 1.25, spin: -1, lens: 0.93 },
  { hue: -0.13, curl: 0.72, turbulence: 0.8, spin: 1.5, lens: 1.07 },
  { hue: 0.26, curl: 1.15, turbulence: 0.7, spin: -1.5, lens: 1.03 },
  { hue: -0.26, curl: 0.9, turbulence: 1.35, spin: 0.6, lens: 0.97 },
];

const NEUTRAL: PartLook = LOOKS[0] ?? { hue: 0, curl: 1, turbulence: 1, spin: 1, lens: 1 };
/** Long enough to feel like a change of light, short enough to arrive with the section. */
const EASE_S = 0.9;
const DROP_LANDED = 0.9;

export function lookOf(part: number): PartLook {
  return part < 0 ? NEUTRAL : (LOOKS[part % LOOKS.length] ?? NEUTRAL);
}

/** The look on screen right now, drifting to each part's own and landing at once on a drop. */
export class PartMemory {
  hue = 0;
  curl = 1;
  turbulence = 1;
  spin = 1;
  lens = 1;

  update(dt: number, audio: AudioFeatures): void {
    const look = audio.living ? lookOf(audio.sectionPart) : NEUTRAL;
    const ease = audio.impact >= DROP_LANDED ? 1 : 1 - Math.exp(-dt / EASE_S);
    this.hue += (look.hue - this.hue) * ease;
    this.curl += (look.curl - this.curl) * ease;
    this.turbulence += (look.turbulence - this.turbulence) * ease;
    this.spin += (look.spin - this.spin) * ease;
    this.lens += (look.lens - this.lens) * ease;
  }
}

/** App-wide: the simulation, camera and post-processing all read it. */
export const partMemory = new PartMemory();
