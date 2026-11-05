import type { Actor } from '../cast';
import { type Score, SCORE_RATE } from './score';

export type SectionKind = 'Quiet' | 'Steady' | 'Big' | 'Climb' | 'Drop';

export interface SongSection {
  readonly start: number;
  readonly end: number;
  /** 0–1 how big it is against the song's own range. */
  readonly size: number;
  readonly kind: SectionKind;
  /** Which part of the song it is, shared with every section like it. */
  readonly part: number;
  /** A letter for that part, in the order the song introduces them. */
  readonly letter: string;
  /** 1 the first time the song plays this part, 2 the second, and so on. */
  readonly visit: number;
}

/** A song's shape, reduced to what fits on one strip. */
export interface SongSummary {
  readonly duration: number;
  readonly sections: readonly SongSection[];
  readonly drops: readonly { time: number; power: number }[];
  /** Level across the song, one value per column. */
  readonly lanes: {
    readonly held: Float32Array;
    readonly notes: Float32Array;
    readonly hits: Float32Array;
    readonly tension: Float32Array;
  };
  /** Which parts the analysis found at all. */
  readonly heard: Record<Actor, boolean>;
}

const COLUMNS = 360;
const QUIET_BELOW = 0.35;
const BIG_FROM = 0.75;
/** How close a time must be to count as the same moment. */
const SAME_MOMENT_S = 0.3;
const MIN_HELD = 0.3;
/** A part has to be there for this much of the song to be listed as heard. */
const HEARD_SHARE = 0.05;
const MIN_NOTES_PER_S = 0.2;
const MIN_HITS_PER_S = 0.25;

function columns(lane: Float32Array, total: number): Float32Array {
  const out = new Float32Array(COLUMNS);
  const per = total / COLUMNS;
  for (let column = 0; column < COLUMNS; column++) {
    const from = Math.floor(column * per);
    const to = Math.max(from + 1, Math.floor((column + 1) * per));
    let sum = 0;
    for (let i = from; i < to; i++) sum += lane[i] ?? 0;
    out[column] = sum / (to - from);
  }
  return out;
}

function hitColumns(lists: readonly Float32Array[], duration: number): Float32Array {
  const out = new Float32Array(COLUMNS);
  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const column = Math.floor(((list[i] ?? 0) / duration) * COLUMNS);
      if (column < COLUMNS) out[column] = (out[column] ?? 0) + 1;
    }
  }
  const top = Math.max(...out, 1);
  return out.map((count) => count / top);
}

function share(lane: Float32Array, above: number): number {
  let count = 0;
  for (let i = 0; i < lane.length; i++) if ((lane[i] ?? 0) >= above) count++;
  return count / Math.max(1, lane.length);
}

function kindOf(start: number, end: number, size: number, score: Score): SectionKind {
  const near = (time: number) => score.drops.some((drop) => Math.abs(drop - time) < SAME_MOMENT_S);
  if (near(start)) return 'Drop';
  if (near(end)) return 'Climb';
  if (score.sectionStarts.length < 2) return 'Steady';
  if (size < QUIET_BELOW) return 'Quiet';
  return size >= BIG_FROM ? 'Big' : 'Steady';
}

/** Boils a score down for the song map. Runs once per song. */
export function summarise(score: Score): SongSummary {
  const { duration, sectionStarts, sectionSizes } = score;
  const frames = Math.max(1, Math.round(duration * SCORE_RATE));
  const letters = new Map<number, string>();
  const visits = new Map<number, number>();
  let lastPart = -1;
  const sections = Array.from(sectionStarts, (start, i) => {
    const end = sectionStarts[i + 1] ?? duration;
    const size = sectionSizes[i] ?? 0;
    const part = score.sectionParts[i] ?? 0;
    if (!letters.has(part)) letters.set(part, String.fromCharCode(65 + (letters.size % 26)));
    // A part split in two by a passing change is still one visit to it.
    if (part !== lastPart) visits.set(part, (visits.get(part) ?? 0) + 1);
    lastPart = part;
    return {
      start,
      end,
      size,
      kind: kindOf(start, end, size, score),
      part,
      letter: letters.get(part) ?? 'A',
      visit: visits.get(part) ?? 1,
    };
  });
  return {
    duration,
    sections,
    drops: Array.from(score.drops, (time, i) => ({ time, power: score.dropPower[i] ?? 1 })),
    lanes: {
      held: columns(score.sustain, frames),
      notes: columns(score.notes, frames),
      hits: hitColumns([score.hits.kick, score.hits.snare], duration),
      tension: columns(score.tension, frames),
    },
    heard: {
      drums: (score.hits.kick.length + score.hits.snare.length) / duration >= MIN_HITS_PER_S,
      bass: share(score.env.bass, MIN_HELD) >= HEARD_SHARE,
      pads: share(score.sustain, MIN_HELD) >= HEARD_SHARE,
      riffs: score.noteTimes.length / duration >= MIN_NOTES_PER_S,
      voice: score.hasVoice
        ? share(score.voice, MIN_HELD) >= HEARD_SHARE
        : share(score.melody, 1) >= HEARD_SHARE,
    },
  };
}

/** The section at a moment in the song. */
export function sectionAt(song: SongSummary, time: number): SongSection | undefined {
  return song.sections.find((section) => time >= section.start && time < section.end);
}
