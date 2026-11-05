/** How far a chord change may turn the palette, as a fraction of the hue circle (±20°). */
export const MAX_HUE_SHIFT = 20 / 360;
/** Saturation moves too: one hue axis alone would give a note and its tritone the same tint. */
export const MAX_SATURATION_SHIFT = 0.08;

/**
 * Where a pitch class sits on the circle of fifths, as a point on the unit circle. Related
 * keys are neighbours there, so a move to the dominant is a nudge and a distant key a swing,
 * and walking the whole circle never jumps.
 */
export function circleOfFifths(pitchClass: number): { x: number; y: number } {
  const angle = (((pitchClass * 7) % 12) / 12) * Math.PI * 2;
  return { x: Math.sin(angle), y: Math.cos(angle) };
}

const FIFTHS = Array.from({ length: 12 }, (_, pitch) => circleOfFifths(pitch));

/**
 * The weighted centre of everything sounding, on the circle of fifths. A single winning note
 * sits on a shared tone or hops between root and third, where this glides as chords move.
 * Chords that share most of their notes land close together, which is the right tint for
 * them. Squaring favours the notes that really ring.
 */
export function harmonicCentre(
  chroma: ArrayLike<number>,
  out: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let weight = 0;
  for (let pitch = 0; pitch < 12; pitch++) {
    const energy = (chroma[pitch] ?? 0) ** 2;
    x += (FIFTHS[pitch]?.x ?? 0) * energy;
    y += (FIFTHS[pitch]?.y ?? 0) * energy;
    weight += energy;
  }
  out.x = weight > 0 ? x / weight : 0;
  out.y = weight > 0 ? y / weight : 0;
  return out;
}

const FIFTH_WEIGHT = 0.8;

/**
 * The triad that best fits the chroma, out of all 24. Matching whole shapes matters because
 * the loudest note is often not the root. `colour` runs from -1 (clearly minor) to 1 (clearly
 * major). Some chords are truly ambiguous: Em7 and G6 are the same four notes.
 */
export function chordOf(
  chroma: ArrayLike<number>,
  out: { root: number; colour: number } = { root: 0, colour: 0 },
): { root: number; colour: number } {
  let major = 0;
  let minor = 0;
  let best = -1;
  for (let pitch = 0; pitch < 12; pitch++) {
    const base = (chroma[pitch] ?? 0) + (chroma[(pitch + 7) % 12] ?? 0) * FIFTH_WEIGHT;
    const asMajor = base + (chroma[(pitch + 4) % 12] ?? 0);
    const asMinor = base + (chroma[(pitch + 3) % 12] ?? 0);
    if (Math.max(asMajor, asMinor) > best) {
      best = Math.max(asMajor, asMinor);
      out.root = pitch;
      major = asMajor;
      minor = asMinor;
    }
  }
  const total = major + minor;
  out.colour = total > 0 ? Math.max(-1, Math.min(1, ((major - minor) / total) * 4)) : 0;
  return out;
}
