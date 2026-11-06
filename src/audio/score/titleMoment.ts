import { SCORE_RATE } from './sections';
import type { Score } from './score';

/** A song needs a moment to get going before its name can land on anything. */
const EARLIEST_S = 10;
/** How full a section must be, and how far above the last one, to count as the song opening up. */
const BIG = 0.6;
const RISE = 0.15;
/** With nothing to go on, a quarter of the way in is after the intro and still early enough. */
const FALLBACK_SHARE = 0.25;

type Shape = Pick<Score, 'drops' | 'sectionStarts' | 'presence' | 'duration'>;

function fullness(presence: Float32Array, from: number, to: number): number {
  const first = Math.floor(from * SCORE_RATE);
  const last = Math.min(presence.length, Math.ceil(to * SCORE_RATE));
  let sum = 0;
  for (let i = first; i < last; i++) sum += presence[i] ?? 0;
  return sum / Math.max(1, last - first);
}

/**
 * When a song should spell its name, in seconds. Drops are the natural place, but plenty of songs
 * never have one, so otherwise it's the first time the song clearly opens up, like a first chorus.
 */
export function titleMoment({ drops, sectionStarts, presence, duration }: Shape): number {
  const drop = drops[0];
  if (drop !== undefined) return drop;

  let biggestRise = 0;
  let biggestAt = duration * FALLBACK_SHARE;
  let previous = 0;
  for (let i = 0; i < sectionStarts.length; i++) {
    const start = sectionStarts[i] ?? 0;
    const end = sectionStarts[i + 1] ?? duration;
    const level = fullness(presence, start, end);
    const rise = level - previous;
    if (i > 0 && start >= EARLIEST_S) {
      if (level >= BIG && rise >= RISE) return start;
      if (rise > biggestRise) {
        biggestRise = rise;
        biggestAt = start;
      }
    }
    previous = level;
  }
  return biggestAt;
}
