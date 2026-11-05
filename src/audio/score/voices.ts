import { SCORE_RATE } from './sections';

/** What's playing besides the drums, read from the whole song at once. */
export interface Voices {
  /** 0–1 per frame: sound that holds, such as pads, organs and held chords. */
  readonly sustain: Float32Array;
  /** 0–1 per frame: sound that moves in notes, such as riffs, arpeggios and plucks. */
  readonly notes: Float32Array;
  /** 0–1 per frame: a lead voice, heard as what moves dead centre; empty if the mix is mono. */
  readonly voice: Float32Array;
  /** False when the mix had no stereo to find a voice with. */
  readonly hasVoice: boolean;
  /** The lead line as a MIDI note per frame, 0 where nothing's leading. */
  readonly line: Float32Array;
  /** 0–1 per frame: how present that line is. */
  readonly lineLevel: Float32Array;
  /** 0–1 per frame: how harsh those notes are, from clean to fully distorted. */
  readonly grit: Float32Array;
  /** 0–1 per frame: how much of the upper mids is a hit rather than a held tone. */
  readonly hitShare: Float32Array;
  /** Seconds, ascending. */
  readonly noteTimes: Float32Array;
  /** MIDI note of each. */
  readonly notePitches: Float32Array;
  /** 0–1 how hard each was struck. */
  readonly noteStrengths: Float32Array;
  /** The range the song's notes mostly span, so each song can use all of the strings. */
  readonly noteLow: number;
  readonly noteHigh: number;
  /** Twelve pitch-class levels per step at `CHROMA_RATE`, strongest = 1. */
  readonly chroma: Float32Array;
  /** When the harmony moves, in seconds. */
  readonly chordTimes: Float32Array;
}

/** Sample rate the mix is analysed at. A voice's identity doesn't need more than 11 kHz. */
export const VOICE_SAMPLE_RATE = 22050;
export const CHROMA_RATE = 10;

const WINDOW = 2048;
/** Spectrum frames per second. */
const FRAME_RATE = 50;
const LOW_NOTE = 40;
const SEMITONE_BANDS = 57;
const TOP_BANDS = 9;
const TOP_BAND_STEP = 4;
const BANDS = SEMITONE_BANDS + TOP_BANDS;
/** Where tones start, above the bass. */
const TONE_FROM = 20;
/** Where tones end, below cymbal wash. */
const TONE_TO = 60;
const HIT_FROM = 32;
const GRIT_FROM = 30;
/** A tone holds across this many frames, where a hit stands out across this many bands. */
const TONE_FRAMES = 11;
const HIT_BANDS = 13;
/**
 * What counts as held: present for most of about a second. A low percentile rather than a
 * median, because a riff's root note fills half of any second and it still isn't a pad.
 */
const HOLD_FRAMES = 45;
const HOLD_RANK = 0.3;
/** Levels as a share of the mix's loudest moments, from nothing to clearly there. */
const HELD_RANGE: readonly [number, number] = [0.02, 0.07];
const MOVING_RANGE: readonly [number, number] = [0.02, 0.09];
const OUTWEIGHS_RANGE: readonly [number, number] = [0.35, 0.55];
const NOTES_OVER_RANGE: readonly [number, number] = [0.3, 0.5];
const VOICE_RANGE: readonly [number, number] = [0.02, 0.09];
/** How much of a tone must be in the sides for it to count as wide, from none to fully. */
const WIDE_RANGE: readonly [number, number] = [0.2, 0.6];
/** Below this much stereo across a song, there's nothing to separate a voice with. */
const MIN_WIDTH = 0.08;
const HOLD_BLUR = 12;
const GRIT_RANGE: readonly [number, number] = [0.25, 0.55];
/** A note has to be this present to count: bass and drums leave faint ones of their own. */
const MIN_NOTE_LEVEL = 0.2;
const NOTE_GAP_FRAMES = 3;
const NOTE_MEMORY_FRAMES = 25;
const NOTE_RATIO = 1.5;
const NOTE_FLOOR = 0.12;
const MIN_SALIENCE = 2.2;
const MIN_SHARPNESS = 0.3;
const MIN_JUMP = 1.5;
const JUMP_BACK = 4;
/** Frames after an onset to read its pitch, once the note has rung up. */
const PITCH_DELAY = 2;
const PITCH_BANDS = 45;
const NOTE_REACH_S = 0.4;
/** The bands a lead line can sit in: an octave above the bottom band to about C6. */
const LINE_FROM = 8;
const LINE_TO = 45;
/** What a step of one semitone costs the line, and the most a leap of any size can. */
const LINE_STEP_COST = 0.25;
const LINE_LEAP_COST = 1.6;
const MIN_LINE_LEVEL = 0.15;
const MIN_LINE_FIT = 0.35;
const LINE_MEDIAN = 2;
const SHORTEST_NOTE_FRAMES = 5;
const LONGEST_GAP_FRAMES = 4;
const CHORD_REACH_S = 0.7;
const CHORD_CHANGE = 0.1;
const CHORD_GAP_S = 0.9;

/** In-place radix-2 complex FFT. */
function fft(re: Float32Array, im: Float32Array, cos: Float32Array, sin: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const swapRe = re[i] ?? 0;
      const swapIm = im[i] ?? 0;
      re[i] = re[j] ?? 0;
      im[i] = im[j] ?? 0;
      re[j] = swapRe;
      im[j] = swapIm;
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const c = cos[k * step] ?? 0;
        const s = sin[k * step] ?? 0;
        const a = start + k;
        const b = a + half;
        const xr = (re[b] ?? 0) * c + (im[b] ?? 0) * s;
        const xi = (im[b] ?? 0) * c - (re[b] ?? 0) * s;
        re[b] = (re[a] ?? 0) - xr;
        im[b] = (im[a] ?? 0) - xi;
        re[a] = (re[a] ?? 0) + xr;
        im[a] = (im[a] ?? 0) + xi;
      }
    }
  }
}

const noteHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Fractional FFT bin at the edges of each band: semitones, then wider bands above them. */
function bandEdges(sampleRate: number): Float32Array {
  const edges = new Float32Array(BANDS * 2);
  const binHz = sampleRate / WINDOW;
  for (let band = 0; band < BANDS; band++) {
    const top = band >= SEMITONE_BANDS;
    const centre = top
      ? LOW_NOTE + SEMITONE_BANDS + (band - SEMITONE_BANDS + 0.5) * TOP_BAND_STEP
      : LOW_NOTE + band;
    const reach = top ? TOP_BAND_STEP / 2 : 0.5;
    edges[band * 2] = noteHz(centre - reach) / binHz;
    edges[band * 2 + 1] = noteHz(centre + reach) / binHz;
  }
  return edges;
}

/** Sums a frame's power into bands, stored band by band. */
function writeBands(
  power: Float32Array,
  edges: Float32Array,
  out: Float32Array,
  frame: number,
  frames: number,
): void {
  for (let band = 0; band < BANDS; band++) {
    const from = edges[band * 2] ?? 0;
    const to = edges[band * 2 + 1] ?? 0;
    const first = Math.ceil(from);
    const last = Math.floor(to);
    let sum = 0;
    if (last >= first) {
      for (let bin = first; bin <= last; bin++) sum += power[bin] ?? 0;
    } else {
      // A low semitone can be narrower than one bin, so it reads between the two either side.
      const mid = (from + to) / 2;
      const below = Math.floor(mid);
      sum = (power[below] ?? 0) * (below + 1 - mid) + (power[below + 1] ?? 0) * (mid - below);
    }
    out[band * frames + frame] = Math.sqrt(sum);
  }
}

/**
 * Magnitude per band and frame for the middle and sides of a mix. Both are real signals, so one
 * complex FFT carries the pair, one in each part, at the cost of a single transform.
 */
function spectrograms(
  mid: Float32Array,
  side: Float32Array | undefined,
  sampleRate: number,
  frames: number,
): { all: Float32Array; wide: Float32Array | null } {
  const all = new Float32Array(BANDS * frames);
  const wide = side ? new Float32Array(BANDS * frames) : null;
  const hop = sampleRate / FRAME_RATE;
  const hann = Float32Array.from(
    { length: WINDOW },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WINDOW),
  );
  const cos = Float32Array.from({ length: WINDOW / 2 }, (_, i) =>
    Math.cos((2 * Math.PI * i) / WINDOW),
  );
  const sin = Float32Array.from({ length: WINDOW / 2 }, (_, i) =>
    Math.sin((2 * Math.PI * i) / WINDOW),
  );
  const edges = bandEdges(sampleRate);
  const re = new Float32Array(WINDOW);
  const im = new Float32Array(WINDOW);
  const midPower = new Float32Array(WINDOW / 2 + 1);
  const sidePower = new Float32Array(WINDOW / 2 + 1);

  for (let frame = 0; frame < frames; frame++) {
    const start = Math.round(frame * hop);
    for (let i = 0; i < WINDOW; i++) {
      re[i] = (mid[start + i] ?? 0) * (hann[i] ?? 0);
      im[i] = side ? (side[start + i] ?? 0) * (hann[i] ?? 0) : 0;
    }
    fft(re, im, cos, sin);
    for (let bin = 0; bin <= WINDOW / 2; bin++) {
      const mirror = (WINDOW - bin) % WINDOW;
      const reSum = (re[bin] ?? 0) + (re[mirror] ?? 0);
      const reGap = (re[bin] ?? 0) - (re[mirror] ?? 0);
      const imSum = (im[bin] ?? 0) + (im[mirror] ?? 0);
      const imGap = (im[bin] ?? 0) - (im[mirror] ?? 0);
      midPower[bin] = (reSum * reSum + imGap * imGap) / 4;
      sidePower[bin] = (imSum * imSum + reGap * reGap) / 4;
    }
    writeBands(midPower, edges, all, frame, frames);
    if (wide) writeBands(sidePower, edges, wide, frame, frames);
  }
  return { all, wide };
}

/** The value at `rank` (0–1) of a window sliding along `source`, kept sorted as it moves. */
function slidingRank(
  source: Float32Array,
  from: number,
  stride: number,
  count: number,
  width: number,
  rank: number,
  out: Float32Array,
): void {
  const half = width >> 1;
  const at = (i: number) => source[from + Math.min(count - 1, Math.max(0, i)) * stride] ?? 0;
  const window = new Float32Array(width);
  for (let i = 0; i < width; i++) window[i] = at(i - half);
  window.sort();
  const pick = Math.floor(rank * (width - 1));
  for (let i = 0; i < count; i++) {
    out[from + i * stride] = window[pick] ?? 0;
    const leaving = at(i - half);
    const arriving = at(i + half + 1);
    if (leaving === arriving) continue;
    let low = 0;
    let high = width - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((window[mid] ?? 0) < leaving) low = mid + 1;
      else high = mid;
    }
    let slot = low;
    while (slot + 1 < width && (window[slot + 1] ?? 0) < arriving) {
      window[slot] = window[slot + 1] ?? 0;
      slot++;
    }
    while (slot > 0 && (window[slot - 1] ?? 0) > arriving) {
      window[slot] = window[slot - 1] ?? 0;
      slot--;
    }
    window[slot] = arriving;
  }
}

/** A value from the top of a list, ignoring the last few outliers. */
function topOf(values: Float32Array): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.floor(sorted.length * 0.98)] ?? 0;
}

const smooth01 = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** Evens a lane out across `reach` frames either side. */
function blur(values: Float32Array, reach: number): Float32Array {
  const out = new Float32Array(values.length);
  let sum = 0;
  for (let i = -reach; i < values.length; i++) {
    sum += values[i + reach] ?? 0;
    if (i - reach - 1 >= 0) sum -= values[i - reach - 1] ?? 0;
    if (i >= 0) out[i] = sum / (reach * 2 + 1);
  }
  return out;
}

/** Spreads a lane from spectrum frames onto the score's frames, on each window's centre. */
function toScoreRate(
  lane: Float32Array,
  duration: number,
  sampleRate: number,
  frames: number,
): Float32Array {
  const out = new Float32Array(Math.ceil(duration * SCORE_RATE));
  const centre = WINDOW / 2 / sampleRate;
  for (let i = 0; i < out.length; i++) {
    const x = (i / SCORE_RATE - centre) * FRAME_RATE;
    const below = Math.min(frames - 1, Math.max(0, Math.floor(x)));
    const above = Math.min(frames - 1, below + 1);
    const part = Math.min(1, Math.max(0, x - below));
    out[i] = (lane[below] ?? 0) * (1 - part) + (lane[above] ?? 0) * part;
  }
  return out;
}

interface Layers {
  all: Float32Array;
  tones: Float32Array;
  hits: Float32Array;
  held: Float32Array;
  moving: Float32Array;
}

/**
 * Splits a song by how long its sounds last. Hits stand out across the spectrum for an
 * instant, notes stand out along one pitch for a moment, and what's left holding for a
 * second or more is a pad or a held chord. This sorts sounds by what they do rather than what
 * they are, which is also how they should look: a held guitar chord behaves like a pad.
 */
function splitLayers(all: Float32Array, frames: number): Layers {
  const alongTime = new Float32Array(all.length);
  const acrossBands = new Float32Array(all.length);
  for (let band = 0; band < BANDS; band++) {
    slidingRank(all, band * frames, 1, frames, TONE_FRAMES, 0.5, alongTime);
  }
  for (let frame = 0; frame < frames; frame++) {
    slidingRank(all, frame, frames, BANDS, HIT_BANDS, 0.5, acrossBands);
  }

  const tones = new Float32Array(all.length);
  const hits = new Float32Array(all.length);
  for (let i = 0; i < all.length; i++) {
    const tone = (alongTime[i] ?? 0) ** 2;
    const hit = (acrossBands[i] ?? 0) ** 2;
    const share = tone / (tone + hit + 1e-12);
    tones[i] = (all[i] ?? 0) * share;
    hits[i] = (all[i] ?? 0) * (1 - share);
  }

  const held = new Float32Array(all.length);
  for (let band = 0; band < BANDS; band++) {
    slidingRank(tones, band * frames, 1, frames, HOLD_FRAMES, HOLD_RANK, held);
  }
  const moving = new Float32Array(all.length);
  for (let i = 0; i < all.length; i++) moving[i] = Math.max(0, (tones[i] ?? 0) - (held[i] ?? 0));
  return { all, tones, hits, held, moving };
}

/**
 * Lead vocals are mixed dead centre, and instruments rarely are, so stereo can tell a rapper from
 * a riff when pitch can't. A mono mix has nothing to go on, and stays all notes.
 */
function splitByWidth(
  moving: Float32Array,
  tones: Float32Array,
  all: Float32Array,
  side: Float32Array | null,
  frames: number,
): { moving: Float32Array; centre: Float32Array; lead: Float32Array; stereo: boolean } {
  const none = new Float32Array(moving.length);
  if (!side) return { moving, centre: none, lead: moving, stereo: false };
  let sideSum = 0;
  let allSum = 0;
  for (let band = TONE_FROM; band < TONE_TO; band++) {
    for (let frame = 0; frame < frames; frame++) {
      sideSum += side[band * frames + frame] ?? 0;
      allSum += all[band * frames + frame] ?? 0;
    }
  }
  if (sideSum / Math.max(allSum, 1e-9) < MIN_WIDTH) {
    return { moving, centre: none, lead: moving, stereo: false };
  }

  const wide = new Float32Array(moving.length);
  const centre = new Float32Array(moving.length);
  const lead = new Float32Array(moving.length);
  for (let i = 0; i < moving.length; i++) {
    const width = (side[i] ?? 0) / Math.max(all[i] ?? 0, 1e-9);
    const share = smooth01(...WIDE_RANGE, width);
    wide[i] = (moving[i] ?? 0) * share;
    centre[i] = (moving[i] ?? 0) * (1 - share);
    // A held note is still the lead, so a voice's pitch is read from all its tone.
    lead[i] = (tones[i] ?? 0) * (1 - share);
  }
  return { moving: wide, centre, lead, stereo: true };
}

/** Root-sum-square of a range of bands, per frame. */
function loudness(layer: Float32Array, frames: number, from: number, to: number): Float32Array {
  const out = new Float32Array(frames);
  for (let band = from; band < to; band++) {
    for (let frame = 0; frame < frames; frame++) {
      out[frame] = (out[frame] ?? 0) + (layer[band * frames + frame] ?? 0) ** 2;
    }
  }
  return out.map(Math.sqrt);
}

/**
 * How much the gaps between pitches are filled in. A clean tone leaves clear space between its
 * harmonics, and distortion fills that space with new ones.
 */
function fill(layer: Float32Array, frames: number): Float32Array {
  const out = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let logs = 0;
    let sum = 0;
    for (let band = GRIT_FROM; band < SEMITONE_BANDS; band++) {
      const value = (layer[band * frames + frame] ?? 0) + 1e-9;
      logs += Math.log(value);
      sum += value;
    }
    const count = SEMITONE_BANDS - GRIT_FROM;
    out[frame] = Math.exp(logs / count) / (sum / count);
  }
  return out;
}

/** Each onset in the moving layer, with the pitch that best explains its harmonics. */
function findNotes(
  moving: Float32Array,
  held: Float32Array,
  tones: Float32Array,
  level: Float32Array,
  frames: number,
  sampleRate: number,
) {
  const rise = new Float32Array(frames);
  for (let band = TONE_FROM; band < TONE_TO; band++) {
    for (let frame = 1; frame < frames; frame++) {
      const now = moving[band * frames + frame] ?? 0;
      const up = now - (moving[band * frames + frame - 1] ?? 0);
      // Drums briefly mask a pad, and it seems to start again as they pass. A real note stands
      // above whatever was already holding at that pitch.
      if (up > 0 && now > (held[band * frames + frame] ?? 0)) {
        rise[frame] = (rise[frame] ?? 0) + up;
      }
    }
  }
  const top = Math.max(topOf(rise), 1e-6);
  const times: number[] = [];
  const pitches: number[] = [];
  const strengths: number[] = [];
  let last = -Infinity;
  const centre = WINDOW / 2 / sampleRate;
  const at = (band: number, frame: number) => moving[band * frames + frame] ?? 0;

  for (let frame = 2; frame < frames - 2; frame++) {
    const value = rise[frame] ?? 0;
    if (value < NOTE_FLOOR * top || value < (rise[frame - 1] ?? 0)) continue;
    if (value < (rise[frame + 1] ?? 0) || frame - last < NOTE_GAP_FRAMES) continue;
    let recent = 0;
    const from = Math.max(0, frame - NOTE_MEMORY_FRAMES);
    for (let i = from; i < frame; i++) recent += rise[i] ?? 0;
    if (value < (recent / Math.max(1, frame - from)) * NOTE_RATIO) continue;

    const read = Math.min(frames - 1, frame + PITCH_DELAY);
    if ((level[read] ?? 0) < MIN_NOTE_LEVEL) continue;
    let best = 0;
    let bestBand = -1;
    let total = 0;
    for (let band = 0; band < PITCH_BANDS; band++) {
      const fit =
        at(band, read) +
        at(band + 12, read) * 0.6 +
        at(band + 19, read) * 0.4 +
        at(band + 24, read) * 0.3;
      total += fit;
      if (fit > best) {
        best = fit;
        bestBand = band;
      }
    }
    if (bestBand < 0 || best < (total / PITCH_BANDS) * MIN_SALIENCE) continue;
    // A swell gets there gradually, where a struck note arrives nearly all at once.
    let reached = 0;
    for (let band = TONE_FROM; band < TONE_TO; band++) reached += at(band, read);
    if (value < reached * MIN_SHARPNESS) continue;
    // Struck, plucked and picked notes jump up at their own pitch. A soft swell just leans in.
    let now = 0;
    let before = 0;
    for (const harmonic of [0, 12, 19]) {
      now += tones[(bestBand + harmonic) * frames + read] ?? 0;
      before += tones[(bestBand + harmonic) * frames + Math.max(0, frame - JUMP_BACK)] ?? 0;
    }
    if (now < before * MIN_JUMP) continue;
    last = frame;
    times.push(frame / FRAME_RATE + centre);
    pitches.push(LOW_NOTE + bestBand);
    strengths.push(Math.min(1, value / top));
  }
  const sorted = Float32Array.from(pitches).sort();
  return {
    noteLow: sorted[Math.floor(sorted.length * 0.05)] ?? 0,
    noteHigh: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    noteTimes: Float32Array.from(times),
    notePitches: Float32Array.from(pitches),
    noteStrengths: Float32Array.from(strengths),
  };
}

/**
 * The lead line through a song, as one continuous path. Reading each moment on its own hops
 * between harmonics and octaves, so the path that best explains the whole song is found at once,
 * with every leap costing something. A tune does leap, but only when the evidence is there.
 */
function findLine(lead: Float32Array, level: Float32Array, frames: number): Float32Array {
  const states = LINE_TO - LINE_FROM;
  const fits = new Float32Array(frames * states);
  const from = new Int8Array(frames * states);
  let best = new Float32Array(states);
  let next = new Float32Array(states);
  const at = (band: number, frame: number) => lead[band * frames + frame] ?? 0;

  for (let frame = 0; frame < frames; frame++) {
    let top = 1e-9;
    for (let state = 0; state < states; state++) {
      const band = LINE_FROM + state;
      const fit =
        at(band, frame) +
        at(band + 12, frame) * 0.5 +
        at(band + 19, frame) * 0.35 +
        at(band + 24, frame) * 0.25;
      fits[frame * states + state] = fit;
      top = Math.max(top, fit);
    }
    let highest = -Infinity;
    for (let state = 0; state < states; state++) {
      const fit = (fits[frame * states + state] ?? 0) / top;
      fits[frame * states + state] = fit;
      let reach = -Infinity;
      let cameFrom = state;
      for (let other = 0; other < states; other++) {
        const cost = Math.min(LINE_LEAP_COST, Math.abs(other - state) * LINE_STEP_COST);
        const value = (best[other] ?? 0) - cost;
        if (value > reach) {
          reach = value;
          cameFrom = other;
        }
      }
      from[frame * states + state] = cameFrom;
      // Quiet frames say nothing about pitch, so the path just coasts through them.
      next[state] = reach + fit * (level[frame] ?? 0);
      highest = Math.max(highest, next[state] ?? 0);
    }
    for (let state = 0; state < states; state++) next[state] = (next[state] ?? 0) - highest;
    [best, next] = [next, best];
  }

  let state = 0;
  for (let other = 1; other < states; other++) {
    if ((best[other] ?? 0) > (best[state] ?? 0)) state = other;
  }
  const path = new Float32Array(frames);
  for (let frame = frames - 1; frame >= 0; frame--) {
    const sure =
      (level[frame] ?? 0) >= MIN_LINE_LEVEL && (fits[frame * states + state] ?? 0) >= MIN_LINE_FIT;
    path[frame] = sure ? LOW_NOTE + LINE_FROM + state : 0;
    state = from[frame * states + state] ?? state;
  }
  return tidyLine(path);
}

/** Closes tiny gaps, removes specks too short to be notes, and evens out single-frame slips. */
function tidyLine(path: Float32Array): Float32Array {
  const out = Float32Array.from(path);
  for (let i = 0; i < out.length;) {
    if ((out[i] ?? 0) > 0) {
      i++;
      continue;
    }
    let end = i;
    while (end < out.length && (out[end] ?? 0) === 0) end++;
    const before = out[i - 1] ?? 0;
    if (end - i <= LONGEST_GAP_FRAMES && before > 0 && end < out.length) out.fill(before, i, end);
    i = end;
  }
  for (let i = 0; i < out.length;) {
    if ((out[i] ?? 0) === 0) {
      i++;
      continue;
    }
    let end = i;
    while (end < out.length && (out[end] ?? 0) > 0) end++;
    if (end - i < SHORTEST_NOTE_FRAMES) out.fill(0, i, end);
    i = end;
  }
  const smooth = Float32Array.from(out);
  const window: number[] = [];
  for (let i = 0; i < out.length; i++) {
    if ((out[i] ?? 0) === 0) continue;
    window.length = 0;
    for (let j = i - LINE_MEDIAN; j <= i + LINE_MEDIAN; j++) {
      if ((out[j] ?? 0) > 0) window.push(out[j] ?? 0);
    }
    window.sort((a, b) => a - b);
    smooth[i] = window[window.length >> 1] ?? 0;
  }
  return smooth;
}

/** A line of notes on the score's frames. Notes can't be blended, so each takes the nearest. */
function notesToScoreRate(
  line: Float32Array,
  duration: number,
  sampleRate: number,
  frames: number,
): Float32Array {
  const out = new Float32Array(Math.ceil(duration * SCORE_RATE));
  const centre = WINDOW / 2 / sampleRate;
  for (let i = 0; i < out.length; i++) {
    const frame = Math.round((i / SCORE_RATE - centre) * FRAME_RATE);
    out[i] = line[Math.min(frames - 1, Math.max(0, frame))] ?? 0;
  }
  return out;
}

/** Movement with no struck notes in it isn't notes, so the lane only counts near real ones. */
function backedByNotes(level: Float32Array, times: Float32Array, sampleRate: number): Float32Array {
  const out = new Float32Array(level.length);
  const centre = WINDOW / 2 / sampleRate;
  const reach = NOTE_REACH_S * FRAME_RATE;
  for (let i = 0; i < times.length; i++) {
    const frame = Math.round(((times[i] ?? 0) - centre) * FRAME_RATE);
    for (let f = Math.max(0, frame - reach); f <= frame + reach && f < out.length; f++) {
      out[f] = level[f] ?? 0;
    }
  }
  return out;
}

/** What's held per step, by pitch class, and when that changes. */
function findHarmony(held: Float32Array, frames: number, sampleRate: number) {
  const perStep = FRAME_RATE / CHROMA_RATE;
  const steps = Math.ceil(frames / perStep);
  const chroma = new Float32Array(steps * 12);
  for (let step = 0; step < steps; step++) {
    let top = 0;
    for (let band = TONE_FROM + 4; band < SEMITONE_BANDS; band++) {
      const pitch = (LOW_NOTE + band) % 12;
      let sum = 0;
      for (let i = 0; i < perStep; i++) sum += held[band * frames + step * perStep + i] ?? 0;
      const slot = step * 12 + pitch;
      chroma[slot] = (chroma[slot] ?? 0) + sum;
      top = Math.max(top, chroma[slot] ?? 0);
    }
    if (top > 1e-6)
      for (let p = 0; p < 12; p++) chroma[step * 12 + p] = (chroma[step * 12 + p] ?? 0) / top;
  }

  const reach = Math.round(CHORD_REACH_S * CHROMA_RATE);
  const mean = (from: number, to: number, out: Float32Array) => {
    out.fill(0);
    for (let step = Math.max(0, from); step < Math.min(steps, to); step++) {
      for (let p = 0; p < 12; p++) out[p] = (out[p] ?? 0) + (chroma[step * 12 + p] ?? 0);
    }
  };
  const before = new Float32Array(12);
  const after = new Float32Array(12);
  const change = new Float32Array(steps);
  for (let step = reach; step < steps - reach; step++) {
    mean(step - reach, step, before);
    mean(step, step + reach, after);
    let dot = 0;
    let a = 0;
    let b = 0;
    for (let p = 0; p < 12; p++) {
      dot += (before[p] ?? 0) * (after[p] ?? 0);
      a += (before[p] ?? 0) ** 2;
      b += (after[p] ?? 0) ** 2;
    }
    change[step] = a > 1e-6 && b > 1e-6 ? 1 - dot / Math.sqrt(a * b) : 0;
  }

  const times: number[] = [];
  const centre = WINDOW / 2 / sampleRate;
  let last = -Infinity;
  for (let step = 1; step < steps - 1; step++) {
    const value = change[step] ?? 0;
    const peak = value >= (change[step - 1] ?? 0) && value > (change[step + 1] ?? 0);
    const time = step / CHROMA_RATE + centre;
    if (peak && value >= CHORD_CHANGE && time - last >= CHORD_GAP_S) {
      times.push(time);
      last = time;
    }
  }
  return { chroma, chordTimes: Float32Array.from(times) };
}

/** No mix to read: a song with no voices, which simply leaves those visuals dark. */
export function silentVoices(frames: number): Voices {
  const lane = () => new Float32Array(frames);
  return {
    sustain: lane(),
    notes: lane(),
    voice: lane(),
    hasVoice: false,
    line: lane(),
    lineLevel: lane(),
    grit: lane(),
    hitShare: lane().fill(1),
    noteTimes: lane().subarray(0, 0),
    notePitches: lane().subarray(0, 0),
    noteStrengths: lane().subarray(0, 0),
    noteLow: 0,
    noteHigh: 0,
    chroma: new Float32Array(0),
    chordTimes: lane().subarray(0, 0),
  };
}

/** Reads everything but the drums out of a song's mix. Pure, and slow, so it runs in a worker. */
export function readVoices(samples: Float32Array, sampleRate: number, side?: Float32Array): Voices {
  const duration = samples.length / sampleRate;
  const frames = Math.max(1, Math.floor(((samples.length - WINDOW) / sampleRate) * FRAME_RATE) + 1);
  const heard = spectrograms(samples, side, sampleRate, frames);
  const { all, hits, tones, held, moving: everyMove } = splitLayers(heard.all, frames);
  const { moving, centre, lead, stereo } = splitByWidth(everyMove, tones, all, heard.wide, frames);

  // Against the whole mix, not each layer's own peak: a song with no pad mustn't grow one.
  const mix = Math.max(topOf(loudness(all, frames, 0, BANDS)), 1e-6);
  const heldShare = loudness(held, frames, TONE_FROM, TONE_TO).map((level) => level / mix);
  const movingShare = loudness(moving, frames, TONE_FROM, TONE_TO).map((level) => level / mix);
  const centreShare = loudness(centre, frames, TONE_FROM, TONE_TO).map((level) => level / mix);
  const voice = centreShare.map((level) => smooth01(...VOICE_RANGE, level));
  const heldEven = blur(heldShare, HOLD_BLUR);
  const everyMoveShare = loudness(everyMove, frames, TONE_FROM, TONE_TO).map(
    (level) => level / mix,
  );
  const movingEven = blur(everyMoveShare, HOLD_BLUR);

  const sustain = new Float32Array(frames);
  const notes = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const heldNow = heldEven[i] ?? 0;
    // A riff leaves some of itself behind in what holds, so a pad has to outweigh what moves.
    const outweighs = heldNow / Math.max(heldNow + (movingEven[i] ?? 0), 1e-6);
    sustain[i] = smooth01(...HELD_RANGE, heldNow) * smooth01(...OUTWEIGHS_RANGE, outweighs);
    // A slow pad always drifts a little, but that's the held sound moving, not notes.
    notes[i] =
      smooth01(...MOVING_RANGE, movingShare[i] ?? 0) * smooth01(...NOTES_OVER_RANGE, 1 - outweighs);
  }

  const grit = fill(tones, frames);

  const hitLevel = loudness(hits, frames, HIT_FROM, BANDS);
  const toneLevel = loudness(tones, frames, HIT_FROM, BANDS);
  const hitShare = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const hit = (hitLevel[i] ?? 0) ** 2;
    hitShare[i] = hit / (hit + (toneLevel[i] ?? 0) ** 2 + 1e-12);
  }

  const found = findNotes(moving, held, tones, notes, frames, sampleRate);
  const lineLevel = blur(stereo ? voice : notes, 4);
  const line = findLine(lead, lineLevel, frames);
  const lane = (values: Float32Array) => toScoreRate(values, duration, sampleRate, frames);
  return {
    sustain: lane(blur(sustain, 6)),
    notes: lane(backedByNotes(notes, found.noteTimes, sampleRate)),
    voice: lane(blur(voice, 2)),
    hasVoice: stereo,
    line: notesToScoreRate(line, duration, sampleRate, frames),
    lineLevel: lane(lineLevel.map((level, i) => ((line[i] ?? 0) > 0 ? level : 0))),
    grit: lane(blur(grit, 12).map((value) => smooth01(...GRIT_RANGE, value))),
    hitShare: lane(hitShare),
    ...found,
    ...findHarmony(tones, frames, sampleRate),
  };
}
