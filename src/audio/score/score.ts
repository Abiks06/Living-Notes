import { BarTracker } from '../phrasing';
import { groupSections } from './memory';
import { type Form, readForm, SCORE_RATE } from './sections';
import { readVoices, silentVoices, type Voices } from './voices';

function readStereoVoices(mix: { left: Float32Array; right: Float32Array; sampleRate: number }) {
  const { left, right, sampleRate } = mix;
  const mid = new Float32Array(left.length);
  const side = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) {
    mid[i] = ((left[i] ?? 0) + (right[i] ?? 0)) / 2;
    side[i] = ((left[i] ?? 0) - (right[i] ?? 0)) / 2;
  }
  return readVoices(mid, sampleRate, side);
}

export { SCORE_RATE };

/** The parts of a song that each get their own visible actor. */
export const LANES = ['kick', 'snare', 'hat', 'bass', 'lead'] as const;
export type Lane = (typeof LANES)[number];
export type Hit = 'kick' | 'snare' | 'hat';

export type LaneAudio = Record<Lane, Float32Array>;

/** A whole song, known before it plays. */
export interface Score extends Readonly<Form>, Voices {
  readonly duration: number;
  /** True when the lanes came from real stems rather than filtered bands. */
  readonly trueStems: boolean;
  /** 0–1 level per lane, at `SCORE_RATE`. */
  readonly env: Record<Lane, Float32Array>;
  /** Hit times in seconds, ascending. */
  readonly hits: Record<Hit, Float32Array>;
  /** Melody as a MIDI note per frame, 0 where nothing clear is sounding. */
  readonly melody: Float32Array;
  /** 0–1 per frame: how present the melody is. */
  readonly melodyLevel: Float32Array;
  /** The range the melody mostly spans, so every song can use the line's full height. */
  readonly melodyLow: number;
  readonly melodyHigh: number;
  readonly bpm: number;
  /** When beat 0 lands, in seconds. */
  readonly beatOffset: number;
  /** Every beat as played, in seconds, for a song too loose for one steady grid. Else empty. */
  readonly beats: Float32Array;
  /** 0–1: how well the hits fit one steady tempo. */
  readonly tempoConfidence: number;
  /** Which beat index is the 1, and how sure that is. */
  readonly downbeat: number;
  readonly barConfidence: number;
  readonly grooveScale: number;
  /** Which part of the song each section is. Sections that come back share a number. */
  readonly sectionParts: Int16Array;
}

const HIT_GAP_S: Record<Hit, number> = { kick: 0.12, snare: 0.1, hat: 0.042 };
/** Level the ear tracks better than raw amplitude. */
const ENV_CURVE = 0.6;
const PREFERRED_BPM = 120;
const MIN_BPM = 60;
const MAX_BPM = 180;
const GAP_STEP_S = 0.02;
const MIN_BACKBEAT_S = 0.7;
const MAX_BACKBEAT_S = 2.6;
/** How much of a song's snares must share one gap for it to count as the backbeat. */
const MIN_BACKBEAT_SHARE = 0.1;
/** How far from a whole number of beats a backbeat can be. */
const BACKBEAT_FIT = 0.12;
const MIN_PULSE_S = 0.33;
const MAX_PULSE_S = 0.6;
const MIN_PULSE_SHARE = 0.35;
/** Below this agreement a song has a human drummer, and the beat is followed rather than ruled. */
const FOLLOW_BELOW = 0.45;
/** How strongly the beat tracker sticks to its tempo against the hits pulling it around. */
const STEADINESS = 5;
const GRID_STEPS = 120;
const GRID_STEP = 0.0001;
const CONFIDENCE_GAIN = 1.25;
/** The share of the upper mids at which a moment counts fully as a hit. */
const FULL_HIT_SHARE = 0.4;
/** How close to the song's tallest hits a snare has to come. */
const SNARE_SHARE = 0.9;
const PITCH_RATE = 20;
const PITCH_DECIMATE = 4;
const PITCH_WINDOW = 512;
const MIN_CLARITY = 0.75;
const FIRST_PEAK = 0.9;
/** Pitch readings either side that a median looks at. */
const MEDIAN_REACH = 2;
const OCTAVE_SLIP = 10;

function quantile(values: Float32Array, q: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
}

/** Level per frame, scaled so the lane's own loud moments reach 1. */
export function envelope(samples: Float32Array, sampleRate: number): Float32Array {
  const hop = sampleRate / SCORE_RATE;
  const frames = Math.max(1, Math.floor(samples.length / hop));
  const out = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    const start = Math.floor(frame * hop);
    const end = Math.min(samples.length, Math.floor((frame + 1) * hop));
    let power = 0;
    for (let i = start; i < end; i++) power += (samples[i] ?? 0) ** 2;
    out[frame] = Math.sqrt(power / Math.max(1, end - start));
  }
  const top = quantile(out, 0.995);
  if (top <= 1e-6) return out.fill(0);
  for (let i = 0; i < frames; i++) out[i] = Math.min(1, (out[i] ?? 0) / top) ** ENV_CURVE;
  return out;
}

/** Times where a level jumps clearly above where it has just been. */
export function pickHits(env: Float32Array, minGapS: number): Float32Array {
  const hits: number[] = [];
  const memory = Math.round(0.25 * SCORE_RATE);
  let last = -Infinity;
  for (let i = 1; i < env.length; i++) {
    const rise = (env[i] ?? 0) - (env[i - 1] ?? 0);
    if (rise < 0.08) continue;
    let recent = 0;
    for (let j = Math.max(0, i - memory); j < i; j++) recent += env[j] ?? 0;
    recent /= Math.max(1, Math.min(memory, i));
    const time = i / SCORE_RATE;
    if ((env[i] ?? 0) > recent * 1.25 + 0.1 && time - last >= minGapS) {
      hits.push(time);
      last = time;
    }
  }
  return Float32Array.from(hits);
}

/**
 * The hits that stand tall. A filtered lane also catches a kick's click and every hat, but a
 * snare is the loudest thing in that part of the spectrum.
 */
function strongest(hits: Float32Array, env: Float32Array): Float32Array {
  const peak = (time: number) => {
    const frame = Math.round(time * SCORE_RATE);
    return Math.max(env[frame] ?? 0, env[frame + 1] ?? 0, env[frame + 2] ?? 0);
  };
  const levels = Float32Array.from(hits, peak);
  const line = quantile(levels, 0.85) * SNARE_SHARE;
  return hits.filter((time) => peak(time) >= line);
}

interface Tempo {
  bpm: number;
  offset: number;
  confidence: number;
}

/** The gap between hits that a song keeps coming back to, in seconds; 0 if none stands out. */
function commonGap(hits: Float32Array, shortest: number, longest: number, share: number): number {
  const counts = new Map<number, number>();
  for (let i = 1; i < hits.length; i++) {
    const gap = Math.round(((hits[i] ?? 0) - (hits[i - 1] ?? 0)) / GAP_STEP_S);
    if (gap * GAP_STEP_S >= shortest && gap * GAP_STEP_S <= longest) {
      counts.set(gap, (counts.get(gap) ?? 0) + 1);
    }
  }
  let best = 0;
  let top = 0;
  for (const [gap, count] of counts) {
    const near = count + (counts.get(gap - 1) ?? 0) + (counts.get(gap + 1) ?? 0);
    if (near > top) {
      top = near;
      best = gap;
    }
  }
  return top >= hits.length * share ? best * GAP_STEP_S : 0;
}

/** Four on the floor needs no working out: when kicks mark a steady pulse, that's the beat. */
function fitKickPulse(beat: number, kicks: Float32Array | undefined): number {
  const pulse = kicks ? commonGap(kicks, MIN_PULSE_S, MAX_PULSE_S, MIN_PULSE_SHARE) : 0;
  return pulse > 0 && Math.abs(beat / pulse - 2) <= BACKBEAT_FIT ? pulse : beat;
}

/**
 * A busy hi-hat pattern can make three-quarters of a beat look like the pulse, and 133 BPM reads
 * as 89. Snares don't have that problem: in nearly all popular music they land two or four
 * beats apart, so a beat that doesn't divide their gap evenly is the wrong beat.
 */
function fitBackbeat(
  beat: number,
  snares: Float32Array | undefined,
  correlate: (lag: number) => number,
): number {
  const gap = snares ? commonGap(snares, MIN_BACKBEAT_S, MAX_BACKBEAT_S, MIN_BACKBEAT_SHARE) : 0;
  if (gap === 0) return beat;
  const beats = gap / beat;
  if (Math.abs(beats - Math.round(beats)) <= BACKBEAT_FIT) return beat;
  let best = beat;
  let bestScore = -Infinity;
  for (const division of [2, 4]) {
    const candidate = gap / division;
    const bpm = 60 / candidate;
    if (bpm < MIN_BPM || bpm > MAX_BPM) continue;
    const octaves = Math.log2(bpm / PREFERRED_BPM);
    const fit = Math.max(1e-6, correlate(Math.round(candidate * SCORE_RATE)));
    const score = fit * Math.exp(-0.5 * octaves * octaves);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/**
 * Pins the beat down exactly. Across a five-minute song a tempo that's 0.05% out drifts by a
 * whole 16th, so the period is chosen by how tightly every hit in the song agrees with it.
 * Hits are compared on the half beat, as offbeat kicks are part of the groove. How tightly they
 * agree is also the honest measure of confidence: rubato spreads them out, and a steady beat
 * lines them up however sparse or syncopated it is.
 */
function lockGrid(beat: number, hits: Float32Array): Tempo {
  const times: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < hits.length; i++) {
    if ((hits[i] ?? 0) > 0) {
      times.push(i / SCORE_RATE);
      weights.push(hits[i] ?? 0);
    }
  }
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) return { bpm: 0, offset: 0, confidence: 0 };

  const agreement = (period: number) => {
    let re = 0;
    let im = 0;
    for (let i = 0; i < times.length; i++) {
      const angle = (2 * Math.PI * (times[i] ?? 0)) / period;
      re += (weights[i] ?? 0) * Math.cos(angle);
      im += (weights[i] ?? 0) * Math.sin(angle);
    }
    return { size: Math.hypot(re, im) / total, angle: Math.atan2(im, re) };
  };

  let half = beat / 2;
  let top = -1;
  for (let step = -GRID_STEPS; step <= GRID_STEPS; step++) {
    const period = (beat / 2) * (1 + step * GRID_STEP);
    const { size } = agreement(period);
    if (size > top) {
      top = size;
      half = period;
    }
  }

  const fold = (angle: number, period: number) =>
    ((((angle / (2 * Math.PI)) * period) % period) + period) % period;
  const onHalf = fold(agreement(half).angle, half);
  const onBeat = fold(agreement(half * 2).angle, half * 2);
  // The half-beat grid is exact; the slower one only says which of its two lines is the beat.
  const offset =
    Math.abs(onBeat - onHalf) < half / 2 || Math.abs(onBeat - onHalf) > half * 1.5
      ? onHalf
      : onHalf + half;
  return {
    bpm: 60 / (half * 2),
    offset: offset % (half * 2),
    confidence: Math.min(1, top * CONFIDENCE_GAIN),
  };
}

/**
 * One steady tempo for the whole song, from autocorrelating its hits. `anchors` are the hits to
 * set the grid by, and `snares` the backbeat, when they're known.
 */
export function findTempo(
  strength: Float32Array,
  snares?: Float32Array,
  anchors?: Float32Array,
  kicks?: Float32Array,
): Tempo {
  const n = strength.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += strength[i] ?? 0;
  mean /= Math.max(1, n);
  const x = Float32Array.from(strength, (value) => value - mean);
  const correlate = (lag: number) => {
    let sum = 0;
    for (let i = lag; i < n; i++) sum += (x[i] ?? 0) * (x[i - lag] ?? 0);
    return (sum * n) / Math.max(1, n - lag);
  };

  let zero = 0;
  for (let i = 0; i < n; i++) zero += (x[i] ?? 0) ** 2;
  if (zero <= 1e-9) return { bpm: 0, offset: 0, confidence: 0 };

  let best = 0;
  let bestScore = 0;
  const minLag = Math.round((60 / MAX_BPM) * SCORE_RATE);
  const maxLag = Math.round((60 / MIN_BPM) * SCORE_RATE);
  for (let lag = minLag; lag <= maxLag; lag++) {
    const octaves = Math.log2((SCORE_RATE * 60) / lag / PREFERRED_BPM);
    const score =
      Math.max(0, correlate(lag) + 0.5 * correlate(lag * 2)) * Math.exp(-0.5 * octaves * octaves);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  if (best === 0) return { bpm: 0, offset: 0, confidence: 0 };

  const fitted = fitKickPulse(fitBackbeat(best / SCORE_RATE, snares, correlate), kicks);
  return lockGrid(fitted, anchors ?? strength);
}

/**
 * The beat as played, for a song that drifts. Each candidate beat keeps the best run of beats
 * leading up to it, trading hits landed on against gaps that stray from the tempo, and the
 * winning run is read back from the end of the song.
 */
export function followBeats(hits: Float32Array, beatS: number): Float32Array {
  const n = hits.length;
  const period = beatS * SCORE_RATE;
  const onset = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const value = hits[i] ?? 0;
    if (value <= 0) continue;
    for (let j = -3; j <= 3; j++) {
      if (i + j >= 0 && i + j < n) {
        onset[i + j] = Math.max(onset[i + j] ?? 0, value * (1 - Math.abs(j) / 4));
      }
    }
  }
  const earliest = Math.round(period * 1.35);
  const latest = Math.round(period * 0.7);
  const reach = new Float32Array(earliest + 1);
  for (let gap = latest; gap <= earliest; gap++) {
    reach[gap] = -STEADINESS * Math.log(gap / period) ** 2 * period;
  }
  const best = new Float32Array(n);
  const from = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    let top = 0;
    for (let gap = latest; gap <= earliest && gap <= t; gap++) {
      const value = (best[t - gap] ?? 0) + (reach[gap] ?? 0);
      if (value > top) {
        top = value;
        from[t] = t - gap;
      }
    }
    best[t] = (onset[t] ?? 0) + top;
  }
  let end = n - 1;
  for (let t = Math.max(0, n - earliest); t < n; t++) {
    if ((best[t] ?? 0) > (best[end] ?? 0)) end = t;
  }
  const beats: number[] = [];
  for (let t = end; t >= 0; t = from[t] ?? -1) beats.unshift(t / SCORE_RATE);
  return Float32Array.from(beats);
}

/** Melody per frame from a lane, by autocorrelation. Unclear frames are left at 0. */
export function findMelody(
  samples: Float32Array,
  sampleRate: number,
  duration: number,
): Float32Array {
  const out = new Float32Array(Math.ceil(duration * SCORE_RATE));
  const rate = sampleRate / PITCH_DECIMATE;
  const minLag = Math.floor(rate / 1100);
  const maxLag = Math.ceil(rate / 110);
  const frame = new Float32Array(PITCH_WINDOW + maxLag + 1);
  const clarity = new Float32Array(maxLag + 2);
  const hold = SCORE_RATE / PITCH_RATE;

  for (let at = 0; at < out.length; at += hold) {
    const start = Math.floor((at / SCORE_RATE) * sampleRate);
    let power = 0;
    for (let i = 0; i < frame.length; i++) {
      const value = samples[start + i * PITCH_DECIMATE] ?? 0;
      frame[i] = value;
      if (i < PITCH_WINDOW) power += value * value;
    }
    if (power / PITCH_WINDOW < 1e-6) continue;

    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      let energy = 0;
      for (let i = 0; i < PITCH_WINDOW; i++) {
        sum += (frame[i] ?? 0) * (frame[i + lag] ?? 0);
        energy += (frame[i + lag] ?? 0) ** 2;
      }
      const value = sum / Math.sqrt(power * Math.max(energy, 1e-9));
      clarity[lag] = value;
      best = Math.max(best, value);
    }
    if (best < MIN_CLARITY) continue;

    // A note correlates at every multiple of its period, and those can score a touch higher.
    // The pitch is the first peak that's nearly as strong, not the strongest one.
    let lag = 0;
    for (let i = minLag + 1; i < maxLag && lag === 0; i++) {
      const value = clarity[i] ?? 0;
      const peak = value >= (clarity[i - 1] ?? 0) && value >= (clarity[i + 1] ?? 0);
      if (peak && value >= best * FIRST_PEAK) lag = i;
    }
    if (lag === 0) continue;
    const left = clarity[lag - 1] ?? 0;
    const middle = clarity[lag] ?? 0;
    const right = clarity[lag + 1] ?? 0;
    const curve = left - 2 * middle + right;
    const exact = lag + (curve !== 0 ? (0.5 * (left - right)) / curve : 0);
    const midi = 69 + 12 * Math.log2(rate / exact / 440);
    for (let i = 0; i < hold && at + i < out.length; i++) out[at + i] = midi;
  }
  return smoothMelody(out, hold);
}

/**
 * Rich tones fool pitch tracking by an octave, frame to frame. Tunes rarely leap that far
 * between notes, so a near-octave jump moves back to the octave of the last reading, and a
 * short median then removes whatever single-frame strays are left.
 */
export function smoothMelody(notes: Float32Array, hold: number): Float32Array {
  const folded = Float32Array.from(notes);
  let last = 0;
  for (let i = 0; i < folded.length; i++) {
    const note = folded[i] ?? 0;
    if (note <= 0) continue;
    // Only near-octave jumps are suspect: a real leap of a fifth must stay a leap of a fifth.
    const slipped = last > 0 && Math.abs(note - last) >= OCTAVE_SLIP;
    const near = slipped ? note + 12 * Math.round((last - note) / 12) : note;
    folded[i] = near;
    last = near;
  }

  const out = new Float32Array(folded.length);
  const reach = hold * MEDIAN_REACH;
  const window: number[] = [];
  for (let i = 0; i < folded.length; i++) {
    if ((folded[i] ?? 0) <= 0) continue;
    window.length = 0;
    for (let j = i - reach; j <= i + reach; j += hold) {
      const note = folded[j] ?? 0;
      if (note > 0) window.push(note);
    }
    window.sort((a, b) => a - b);
    out[i] = window[window.length >> 1] ?? 0;
  }
  return out;
}

const hitNear = (hits: Float32Array, time: number, reach: number) => {
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i] ?? 0;
    if (hit > time + reach) return false;
    if (hit >= time - reach) return true;
  }
  return false;
};

/** Reads the bar from where the drums land, using the same logic as live playback. */
function findBar(tempo: Tempo, kicks: Float32Array, snares: Float32Array, duration: number) {
  const bars = new BarTracker();
  if (tempo.bpm <= 0) return { downbeat: 0, confidence: 0, scale: 1 };
  const beat = 60 / tempo.bpm;
  const beats = Math.floor((duration - tempo.offset) / beat);
  for (let i = 0; i < beats; i++) {
    const time = tempo.offset + i * beat;
    bars.update(i, 0, tempo.bpm, true, hitNear(kicks, time, 0.07), hitNear(snares, time, 0.07));
    bars.update(i, 0.5, tempo.bpm, true, false, false);
  }
  const last = Math.max(0, beats - 1);
  bars.update(last + 1, 0, tempo.bpm, true, false, false);
  return {
    downbeat: (((last + 1 - bars.barBeat) % 4) + 4) % 4,
    confidence: bars.confidence,
    scale: bars.grooveScale,
  };
}

/** Turns a song's lanes into a score. Pure, so it can be tested without any audio API. */
export function buildScore(
  lanes: LaneAudio,
  sampleRate: number,
  trueStems: boolean,
  mix?: { left: Float32Array; right: Float32Array; sampleRate: number },
): Score {
  const duration = lanes.kick.length / sampleRate;
  const env = {
    kick: envelope(lanes.kick, sampleRate),
    snare: envelope(lanes.snare, sampleRate),
    hat: envelope(lanes.hat, sampleRate),
    bass: envelope(lanes.bass, sampleRate),
    lead: envelope(lanes.lead, sampleRate),
  };
  const voices = mix ? readStereoVoices(mix) : silentVoices(env.kick.length);
  // A guitar lives right where a filtered snare lane listens, so only hits may count as snares.
  if (!trueStems) {
    for (let i = 0; i < env.snare.length; i++) {
      const hit = Math.min(1, (voices.hitShare[i] ?? 1) / FULL_HIT_SHARE);
      env.snare[i] = (env.snare[i] ?? 0) * hit;
    }
  }
  const hits = {
    kick: pickHits(env.kick, HIT_GAP_S.kick),
    snare: trueStems
      ? pickHits(env.snare, HIT_GAP_S.snare)
      : strongest(pickHits(env.snare, HIT_GAP_S.snare), env.snare),
    hat: pickHits(env.hat, HIT_GAP_S.hat),
  };

  // The same balance as live tempo tracking: off-grid kicks mislead, backbeats and hats don't.
  const frames = env.kick.length;
  const strength = new Float32Array(frames);
  const mark = (list: Float32Array, weight: number) => {
    for (let i = 0; i < list.length; i++) {
      const frame = Math.round((list[i] ?? 0) * SCORE_RATE);
      if (frame < frames) strength[frame] = (strength[frame] ?? 0) + weight;
    }
  };
  mark(hits.kick, 1);
  mark(hits.snare, 1.35);
  mark(hits.hat, 0.5);
  const anchors = new Float32Array(frames);
  for (const list of [hits.kick, hits.snare]) {
    for (let i = 0; i < list.length; i++) {
      const frame = Math.round((list[i] ?? 0) * SCORE_RATE);
      if (frame < frames) anchors[frame] = 1;
    }
  }
  const tempo = findTempo(strength, hits.snare, anchors, hits.kick);

  const bar = findBar(tempo, hits.kick, hits.snare, duration);
  const form = readForm(env, frames, tempo.bpm, tempo.offset, tempo.confidence, hits.kick);
  const stem = trueStems || !mix;
  const melody = stem ? findMelody(lanes.lead, sampleRate, duration) : voices.line;
  const sung = melody.filter((note) => note > 0).sort();
  return {
    duration,
    trueStems,
    env,
    hits,
    melody,
    melodyLevel: stem ? env.lead : voices.lineLevel,
    melodyLow: sung[Math.floor(sung.length * 0.05)] ?? 0,
    melodyHigh: sung[Math.floor(sung.length * 0.95)] ?? 0,
    bpm: tempo.bpm,
    beatOffset: tempo.offset,
    beats:
      tempo.bpm > 0 && tempo.confidence < FOLLOW_BELOW
        ? followBeats(anchors, 60 / tempo.bpm)
        : new Float32Array(0),
    tempoConfidence: tempo.confidence,
    downbeat: bar.downbeat,
    barConfidence: bar.confidence,
    grooveScale: bar.scale,
    ...form,
    ...voices,
    sectionParts: groupSections(form.sectionStarts, form.sectionSizes, frames, env, voices),
  };
}
