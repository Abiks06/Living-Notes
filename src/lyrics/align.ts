import type { LyricLine } from './lrc';

/**
 * Lengths this close mean the same recording, and on real songs its lyrics then already land
 * within a third of a second. Searching anyway only finds false fits: verses repeat, so a shift
 * of a few bars can look just as good as none.
 */
const SAME_LENGTH_S = 2.5;
/** A little room either side of what the difference in length could explain. */
const SLACK_S = 2;
const STEP_S = 0.1;
/** Just after a line starts someone is singing; just before, usually less so. */
const AFTER_FROM_S = 0.1;
const AFTER_TO_S = 0.7;
const BEFORE_FROM_S = 0.6;
const BEFORE_TO_S = 0.1;
const MIN_LINES = 8;
/** How far apart two fits have to be to count as rivals rather than one broad peak. */
const RIVAL_APART_S = 1;
/** How clearly the best has to beat its best rival, in spreads of the scores. */
const MIN_EDGE = 0.6;

/** Sums of a curve, so the average of any stretch costs two lookups. */
function runningSums(curve: Float32Array): Float64Array {
  const sums = new Float64Array(curve.length + 1);
  for (let i = 0; i < curve.length; i++) sums[i + 1] = (sums[i] ?? 0) + (curve[i] ?? 0);
  return sums;
}

/**
 * How many seconds to move lyrics so their lines start where the voice does, or 0 if there's no
 * clear reason to. Lyrics are timed to someone else's copy, and a music video's intro can put
 * this one seconds behind it.
 *
 * @param voice 0-1 per frame, how much lead voice there is.
 * @param rate Frames per second of that curve.
 * @param spare How much longer this copy is than the one the lyrics were timed to, in seconds.
 */
export function lyricShift(
  lines: readonly LyricLine[],
  voice: Float32Array,
  rate: number,
  spare: number,
): number {
  if (Math.abs(spare) < SAME_LENGTH_S || lines.length < MIN_LINES || voice.length === 0) return 0;

  const sums = runningSums(voice);
  const mean = (from: number, to: number) => {
    const start = Math.max(0, Math.min(voice.length, Math.round(from * rate)));
    const end = Math.max(0, Math.min(voice.length, Math.round(to * rate)));
    return end > start ? ((sums[end] ?? 0) - (sums[start] ?? 0)) / (end - start) : 0;
  };
  const fit = (shift: number) => {
    let total = 0;
    for (const line of lines) {
      const start = line.time + shift;
      total +=
        mean(start + AFTER_FROM_S, start + AFTER_TO_S) -
        mean(start - BEFORE_FROM_S, start - BEFORE_TO_S);
    }
    return total / lines.length;
  };

  const lowest = Math.round((Math.min(0, spare) - SLACK_S) / STEP_S);
  const highest = Math.round((Math.max(0, spare) + SLACK_S) / STEP_S);
  const scores: number[] = [];
  for (let step = lowest; step <= highest; step++) scores.push(fit(step * STEP_S));

  const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const spread = Math.sqrt(
    scores.reduce((sum, value) => sum + (value - average) ** 2, 0) / scores.length,
  );
  const best = scores.reduce((top, value, index) => (value > (scores[top] ?? 0) ? index : top), 0);
  let rival = -Infinity;
  scores.forEach((value, index) => {
    if (Math.abs(index - best) * STEP_S > RIVAL_APART_S) rival = Math.max(rival, value);
  });
  const edge = spread > 1e-6 ? ((scores[best] ?? 0) - rival) / spread : 0;
  return edge >= MIN_EDGE ? Number(((best + lowest) * STEP_S).toFixed(1)) : 0;
}
