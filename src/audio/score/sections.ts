import type { Lane } from './score';

/** Frames per second of everything stored in a score. */
export const SCORE_RATE = 100;

/** What a song's shape adds to its score. */
export interface Form {
  /** 0–1 how big each frame's section is. Jumps up on the beat, so nothing gives a drop away. */
  presence: Float32Array;
  /** Drop times in seconds, ascending. */
  drops: Float32Array;
  /** 0–1 per drop: how big it is against the song's biggest. */
  dropPower: Float32Array;
  /** 0–1 per drop: how far the picture may freeze before it. A small lift shouldn't stop time. */
  hangs: Float32Array;
  /** 0–1 per frame: the climb toward a drop. */
  tension: Float32Array;
  /** 0–1 per frame: the section a drop opened. */
  world: Float32Array;
  /** Where each section starts, in seconds, and how big it is, 0–1. */
  sectionStarts: Float32Array;
  sectionSizes: Float32Array;
}

interface Section {
  start: number;
  end: number;
  /** 0–1 against the song's own quietest and biggest sections. */
  size: number;
  /** How much low end it has, which is what a drop brings back. */
  low: number;
}

const LANE_WEIGHT: Record<Lane, number> = {
  kick: 0.3,
  bass: 0.3,
  snare: 0.15,
  hat: 0.1,
  lead: 0.15,
};
const FEATURE_LANES = Object.keys(LANE_WEIGHT) as Lane[];
/** Without a tempo, sections are read in steps of this long. */
const FREE_STEP_S = 0.5;
/** Keeps the search fast on very long files. */
const MAX_STEPS = 1500;
/** Two bars: anything shorter is a fill, not a section. */
const MIN_SECTION_STEPS = 8;
/** Steps apart when measuring how much a lane wanders from bar to bar. */
const BAR_STEPS = 4;
/** A loop that repeats exactly has no wander at all, but a section still has to mean something. */
const MIN_NOISE = 0.04;
/** How much better a split must fit before it's believed. */
const SPLIT_PENALTY = 1;
const FLAT_SIZE = 0.8;
const SIZE_CURVE = 1.4;
/** Too close to the start to be anything but the song beginning. */
const EARLIEST_DROP_S = 4;
const DROP_MIN_SIZE = 0.8;
const DROP_MIN_RISE = 0.25;
const MAX_DROPS = 4;
const DROP_GAP_BARS = 8;
const BUILD_MAX_BARS = 8;
const BUILD_MIN_BARS = 2;
const FULL_HANG_RISE = 0.6;
const MIN_DROP_POWER = 0.6;
/** Only a drop arrives at once. Every other change of section eases, in or out, over this. */
const PRESENCE_EASE_S = 0.5;
const WORLD_EASE_S = 0.8;
/** A later section this much smaller means the drop's world has ended. */
const WORLD_END_DROP = 0.15;
const SNAP_TO_KICK_S = 0.07;
/** How hard the low end must slam in. A swell can be just as big, but nothing about it hits. */
const MIN_ATTACK = 0.2;
const ATTACK_FRAMES = 3;
const FIRST_HIT_SHARE = 0.55;
const HOLD_FRAMES = 50;
const HOLD_SHARE = 0.85;
/** Kicks a drop needs in the four seconds after it. Without a beat, a lift is just a lift. */
const MIN_KICKS_AFTER = 3;
/** Without a steady beat to land on, a lift is just a lift, however suddenly it arrives. */
const MIN_TEMPO_CONFIDENCE = 0.2;

function median(values: Float32Array): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[sorted.length >> 1] ?? 0;
}

/** Frame where each step starts, plus the song's end: one step per beat when the tempo's known. */
function stepEdges(frames: number, bpm: number, offset: number): number[] {
  const beat = bpm > 0 ? 60 / bpm : FREE_STEP_S;
  const size = beat * Math.ceil(frames / SCORE_RATE / beat / MAX_STEPS);
  const edges = [0];
  for (let t = offset % size || size; t * SCORE_RATE < frames; t += size) {
    edges.push(Math.round(t * SCORE_RATE));
  }
  edges.push(frames);
  return edges;
}

/** Each lane's mean per step, in units of how much that lane wanders on its own. */
function stepFeatures(env: Record<Lane, Float32Array>, edges: number[]): Float32Array[] {
  const steps = edges.length - 1;
  return FEATURE_LANES.map((lane) => {
    const values = new Float32Array(steps);
    for (let i = 0; i < steps; i++) {
      const from = edges[i] ?? 0;
      const to = edges[i + 1] ?? from;
      let sum = 0;
      for (let f = from; f < to; f++) sum += env[lane][f] ?? 0;
      values[i] = sum / Math.max(1, to - from);
    }
    // Compared a bar apart, so a backbeat isn't mistaken for wandering. The median ignores
    // the few moments that really do change, and 0.91 is what turns it into a variance.
    const gaps = new Float32Array(Math.max(1, steps - BAR_STEPS));
    for (let i = 0; i + BAR_STEPS < steps; i++) {
      gaps[i] = ((values[i + BAR_STEPS] ?? 0) - (values[i] ?? 0)) ** 2;
    }
    const noise = Math.max(MIN_NOISE, Math.sqrt(median(gaps) / 0.91));
    return values.map((value) => value / noise);
  });
}

/**
 * Where the song really changes: the split that best explains it as stretches of steady sound.
 * This is measured against how much each lane normally wanders, not against a fixed level,
 * because a loud master can change a lot while its level barely moves, and a chord change can
 * move the level a lot without being a new section.
 */
function findStarts(features: Float32Array[], steps: number): number[] {
  if (steps < MIN_SECTION_STEPS * 2) return [0];
  const sums = features.map((values) => {
    const prefix = new Float64Array(steps + 1);
    for (let i = 0; i < steps; i++) prefix[i + 1] = (prefix[i] ?? 0) + (values[i] ?? 0);
    return prefix;
  });
  const squares = features.map((values) => {
    const prefix = new Float64Array(steps + 1);
    for (let i = 0; i < steps; i++) prefix[i + 1] = (prefix[i] ?? 0) + (values[i] ?? 0) ** 2;
    return prefix;
  });
  const misfit = (from: number, to: number) => {
    let cost = 0;
    for (let lane = 0; lane < features.length; lane++) {
      const sum = (sums[lane]?.[to] ?? 0) - (sums[lane]?.[from] ?? 0);
      cost += (squares[lane]?.[to] ?? 0) - (squares[lane]?.[from] ?? 0) - (sum * sum) / (to - from);
    }
    return cost;
  };

  const penalty = SPLIT_PENALTY * (features.length + 1) * Math.log(steps);
  const best = new Float64Array(steps + 1).fill(Infinity);
  const from = new Int32Array(steps + 1);
  best[0] = 0;
  for (let end = MIN_SECTION_STEPS; end <= steps; end++) {
    for (let start = 0; start <= end - MIN_SECTION_STEPS; start++) {
      const before = best[start] ?? Infinity;
      if (before === Infinity) continue;
      const cost = before + misfit(start, end) + (start > 0 ? penalty : 0);
      if (cost < (best[end] ?? Infinity)) {
        best[end] = cost;
        from[end] = start;
      }
    }
  }

  const starts: number[] = [];
  for (let end = steps; end > 0; end = from[end] ?? 0) starts.unshift(from[end] ?? 0);
  return starts;
}

function measure(
  env: Record<Lane, Float32Array>,
  starts: number[],
  edges: number[],
  frames: number,
) {
  const sections: Section[] = [];
  const raw: number[] = [];
  starts.forEach((step, i) => {
    const start = edges[step] ?? 0;
    const end = i + 1 < starts.length ? (edges[starts[i + 1] ?? 0] ?? frames) : frames;
    const mean = (lane: Lane) => {
      let sum = 0;
      for (let f = start; f < end; f++) sum += env[lane][f] ?? 0;
      return sum / Math.max(1, end - start);
    };
    raw.push(FEATURE_LANES.reduce((sum, lane) => sum + mean(lane) * LANE_WEIGHT[lane], 0));
    sections.push({ start, end, size: FLAT_SIZE, low: (mean('kick') + mean('bass')) / 2 });
  });
  if (sections.length > 1) {
    const low = Math.min(...raw);
    const range = Math.max(Math.max(...raw) - low, 1e-3);
    sections.forEach((section, i) => {
      section.size = ((raw[i] ?? 0) - low) / range;
    });
  }
  return sections;
}

interface Drop {
  section: number;
  /** The first frame of the climb. */
  buildFrom: number;
  rise: number;
  rank: number;
}

/**
 * The song's biggest arrivals. A drop isn't a level but a lift into one of the song's biggest
 * sections from something clearly smaller, so a steady song has none, and drums merely
 * entering part way up don't count.
 */
function pickDrops(sections: Section[], bar: number): Drop[] {
  const reach = bar * BUILD_MAX_BARS;
  const found: Drop[] = [];
  sections.forEach((section, i) => {
    const previous = sections[i - 1];
    if (!previous || section.start / SCORE_RATE < EARLIEST_DROP_S) return;
    // A build often climbs out of a break, so the lift counts from the bottom of that dip.
    const earlier = sections[i - 2];
    const lowest =
      earlier && section.start - previous.start <= reach && earlier.size < previous.size
        ? earlier
        : previous;
    const rise = section.size - lowest.size;
    if (section.size < DROP_MIN_SIZE || rise < DROP_MIN_RISE || section.size <= previous.size) {
      return;
    }
    found.push({
      section: i,
      buildFrom: Math.max(lowest.start, section.start - reach),
      rise,
      rank: rise + Math.max(0, section.low - previous.low) * 0.5 + section.size * 0.4,
    });
  });

  const kept: Drop[] = [];
  for (const drop of found.sort((a, b) => b.rank - a.rank)) {
    const at = sections[drop.section]?.start ?? 0;
    const clear = kept.every(
      (other) => Math.abs((sections[other.section]?.start ?? 0) - at) >= bar * DROP_GAP_BARS,
    );
    if (clear && kept.length < MAX_DROPS) kept.push(drop);
  }
  return kept.sort((a, b) => a.section - b.section);
}

/**
 * Steps are only as exact as the beat grid, so the moment itself comes from where the low end
 * actually slams back in, then from the kick there.
 */
function landing(
  env: Record<Lane, Float32Array>,
  frame: number,
  reach: number,
  kicks: Float32Array,
): { frame: number; attack: number } {
  const low = (f: number) => (env.kick[f] ?? 0) + (env.bass[f] ?? 0);
  const rise = (f: number) => low(f + ATTACK_FRAMES) - low(f - ATTACK_FRAMES);
  const from = Math.max(ATTACK_FRAMES, frame - reach);
  let attack = -Infinity;
  for (let f = from; f <= frame + reach; f++) attack = Math.max(attack, rise(f));
  const mean = (start: number, frames: number) => {
    let sum = 0;
    for (let f = start; f < start + frames; f++) sum += low(f);
    return sum / frames;
  };
  // The first hit that holds. A later kick can hit harder than the drop, and a pickup can come
  // before it, often with a gap right after, so what follows has to match what's coming.
  let best = frame;
  let hardest = -Infinity;
  for (let f = from; f <= frame + reach; f++) {
    if (rise(f) > hardest) {
      hardest = rise(f);
      best = f;
    }
  }
  for (let f = from; f <= frame + reach; f++) {
    const holds = mean(f, HOLD_FRAMES) >= mean(f, HOLD_FRAMES * 4) * HOLD_SHARE;
    if (rise(f) >= attack * FIRST_HIT_SHARE && holds) {
      best = f;
      break;
    }
  }
  let nearest = best;
  let gap = SNAP_TO_KICK_S * SCORE_RATE;
  for (let i = 0; i < kicks.length; i++) {
    const at = (kicks[i] ?? 0) * SCORE_RATE;
    if (Math.abs(at - best) <= gap) {
      gap = Math.abs(at - best);
      nearest = Math.round(at);
    }
  }
  return { frame: nearest, attack };
}

/** Follows a value per frame, easing between sections and jumping only on the given frames. */
function bake(values: Float32Array, easeS: number, jumps: ReadonlySet<number>): Float32Array {
  const out = new Float32Array(values.length);
  const most = 1 / (easeS * SCORE_RATE);
  for (let i = 0; i < values.length; i++) {
    const target = values[i] ?? 0;
    const last = i === 0 ? target : (out[i - 1] ?? 0);
    out[i] = jumps.has(i) ? target : last + Math.min(most, Math.max(-most, target - last));
  }
  return out;
}

/** Reads a song's sections and drops, once, from the whole of it. */
export function readForm(
  env: Record<Lane, Float32Array>,
  frames: number,
  bpm: number,
  offset: number,
  tempoConfidence: number,
  kicks: Float32Array,
): Form {
  const beat = bpm > 0 ? 60 / bpm : FREE_STEP_S;
  const bar = beat * 4 * SCORE_RATE;
  const edges = stepEdges(frames, bpm, offset);
  const steps = edges.length - 1;
  const sections = measure(env, findStarts(stepFeatures(env, edges), steps), edges, frames);

  const reach = Math.round(beat * 1.5 * SCORE_RATE);
  const candidates = tempoConfidence >= MIN_TEMPO_CONFIDENCE ? pickDrops(sections, bar) : [];
  const picked = candidates.filter((drop) => {
    const section = sections[drop.section];
    const previous = sections[drop.section - 1];
    if (!section || !previous) return false;
    const { frame, attack } = landing(env, section.start, reach, kicks);
    if (attack < MIN_ATTACK) return false;
    const time = frame / SCORE_RATE;
    const after = kicks.filter((kick) => kick >= time - 0.1 && kick < time + 4);
    if (after.length < MIN_KICKS_AFTER) return false;
    section.start = frame;
    previous.end = frame;
    return true;
  });
  const top = Math.max(...picked.map((drop) => drop.rank), 1e-3);
  const moved = picked.map((drop) => sections[drop.section]?.start ?? 0);
  const landings = new Set(moved);

  const sizeAt = new Float32Array(frames);
  for (const section of sections) {
    sizeAt.fill(section.size ** SIZE_CURVE, section.start, section.end);
  }

  const tension = new Float32Array(frames);
  const worldAt = new Float32Array(frames);
  const power = picked.map((drop) => MIN_DROP_POWER + (1 - MIN_DROP_POWER) * (drop.rank / top));
  picked.forEach((drop, i) => {
    const at = moved[i] ?? 0;
    const from = Math.round(Math.min(drop.buildFrom, at - bar * BUILD_MIN_BARS));
    for (let f = Math.max(0, from); f < at; f++) {
      const x = (f - from) / (at - from);
      tension[f] = Math.max(tension[f] ?? 0, x * x * (power[i] ?? 1));
    }
    const size = sections[drop.section]?.size ?? 0;
    let end = frames;
    for (let s = drop.section + 1; s < sections.length; s++) {
      if ((sections[s]?.size ?? 0) < size - WORLD_END_DROP) {
        end = sections[s]?.start ?? frames;
        break;
      }
    }
    worldAt.fill(power[i] ?? 1, at, end);
  });

  return {
    presence: bake(sizeAt, PRESENCE_EASE_S, landings),
    drops: Float32Array.from(moved, (frame) => frame / SCORE_RATE),
    dropPower: Float32Array.from(power),
    hangs: Float32Array.from(picked, (drop) => Math.min(1, drop.rise / FULL_HANG_RISE)),
    tension,
    world: bake(worldAt, WORLD_EASE_S, landings),
    sectionStarts: Float32Array.from(sections, (section) => section.start / SCORE_RATE),
    sectionSizes: Float32Array.from(sections, (section) => section.size),
  };
}
