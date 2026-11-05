import type { Lane } from './score';
import { SCORE_RATE } from './sections';
import { CHROMA_RATE, type Voices } from './voices';

/** How alike two sections must be to count as the same part of the song. */
const SAME_PART = 0.86;
/** Harmony and sound count equally: a loop's chords never change, and a chorus's rarely do. */
const HARMONY_WEIGHT = 0.5;
/** A difference of this much in a level, on average, leaves two sections nothing in common. */
const FULL_DIFFERENCE = 0.5;
/** Near silence is all the same part, whatever faint harmony it has. */
const SILENT_SIZE = 0.08;
const SIZE_WEIGHT = 4;

interface Print {
  chroma: Float32Array;
  levels: Float32Array;
  length: number;
  size: number;
}

function meanOf(lane: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += lane[i] ?? 0;
  return sum / Math.max(1, to - from);
}

/** What a section sounds like, boiled down to its harmony and how much of each part is in it. */
function fingerprint(
  from: number,
  to: number,
  size: number,
  env: Record<Lane, Float32Array>,
  voices: Voices,
): Print {
  const chroma = new Float32Array(12);
  const first = Math.floor((from / SCORE_RATE) * CHROMA_RATE);
  const last = Math.ceil((to / SCORE_RATE) * CHROMA_RATE);
  for (let step = first; step < last; step++) {
    for (let pitch = 0; pitch < 12; pitch++) {
      chroma[pitch] = (chroma[pitch] ?? 0) + (voices.chroma[step * 12 + pitch] ?? 0);
    }
  }
  const lanes = [
    env.kick,
    env.bass,
    env.snare,
    env.hat,
    voices.sustain,
    voices.notes,
    voices.voice,
    voices.grit,
  ];
  const levels = lanes.map((lane) => meanOf(lane, from, to));
  // Size counts for more than any one part: a verse and a chorus often share everything else.
  for (let i = 0; i < SIZE_WEIGHT; i++) levels.push(size);
  return {
    chroma,
    levels: Float32Array.from(levels),
    length: to - from,
    size,
  };
}

function likeness(a: Print, b: Print): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let pitch = 0; pitch < 12; pitch++) {
    dot += (a.chroma[pitch] ?? 0) * (b.chroma[pitch] ?? 0);
    aa += (a.chroma[pitch] ?? 0) ** 2;
    bb += (b.chroma[pitch] ?? 0) ** 2;
  }
  const harmony = aa > 1e-9 && bb > 1e-9 ? dot / Math.sqrt(aa * bb) : 1;
  let gap = 0;
  for (let i = 0; i < a.levels.length; i++) {
    gap += Math.abs((a.levels[i] ?? 0) - (b.levels[i] ?? 0));
  }
  const sound = Math.max(0, 1 - gap / a.levels.length / FULL_DIFFERENCE);
  return harmony * HARMONY_WEIGHT + sound * (1 - HARMONY_WEIGHT);
}

/**
 * Works out which sections are the same part of the song coming back. Parts are numbered with
 * the one the song spends longest in first, so that part can keep the look it started with.
 */
export function groupSections(
  starts: Float32Array,
  sizes: Float32Array,
  frames: number,
  env: Record<Lane, Float32Array>,
  voices: Voices,
): Int16Array {
  const prints = Array.from(starts, (start, i) =>
    fingerprint(
      Math.round(start * SCORE_RATE),
      Math.round((starts[i + 1] ?? frames / SCORE_RATE) * SCORE_RATE),
      sizes[i] ?? 0,
      env,
      voices,
    ),
  );

  const parts: Print[][] = [];
  const raw = prints.map((print) => {
    let best = -1;
    let top = SAME_PART;
    parts.forEach((members, part) => {
      const silent = print.size < SILENT_SIZE && (members[0]?.size ?? 1) < SILENT_SIZE;
      const score = silent ? 1 : Math.max(...members.map((member) => likeness(print, member)));
      if (score >= top) {
        top = score;
        best = part;
      }
    });
    if (best < 0) {
      parts.push([print]);
      return parts.length - 1;
    }
    parts[best]?.push(print);
    return best;
  });

  const time = parts.map((members) => members.reduce((sum, print) => sum + print.length, 0));
  const order = parts.map((_, part) => part).sort((a, b) => (time[b] ?? 0) - (time[a] ?? 0));
  const rank = new Map(order.map((part, place) => [part, place]));
  return Int16Array.from(raw, (part) => rank.get(part) ?? 0);
}
