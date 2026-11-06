/**
 * Scores live analysis against what the whole-song score says, on real music. It runs the real
 * analysers in an OfflineAudioContext at 60 Hz, as audioBench does, and compares each frame.
 *
 * The score is the reference because it's what a local file gets, not because it's always right.
 * In the dev server's console, with an audio file as a Blob:
 *
 *   (await import('/src/dev/liveBench.ts')).benchSong(blob, 'name').then(console.log)
 */
import { withoutCoverArt } from '../audio/flac';
import { FeatureExtractor } from '../audio/featureExtractor';
import { createAudioFeatures, FFT_SIZE, PITCH_FFT_SIZE } from '../audio/features';
import { scoreFromMix } from '../audio/score/loadScore';
import { ScorePlayer } from '../audio/score/scorePlayer';
import { MAX_DECIBELS, MIN_DECIBELS } from '../audio/tone';

const RATE = 60;
const LIMIT_S = 200;
/** How close a live drop must be to a real one to count. */
const DROP_TOLERANCE_S = 1.5;
const KICK_TOLERANCE_S = 0.08;
/** Shape needs a while to learn the song, so it's judged after this. */
const SETTLED_S = 45;
const PUNCH_WINDOW_S = 0.6;

export interface LiveReport {
  name: string;
  seconds: number;
  bpm: number;
  drops: { real: number[]; live: number[]; found: number; extra: number };
  kicks: { real: number; live: number; f1: number };
  /** How much energy moves on the beat, rather than sitting high. */
  punch: { live: number; score: number };
  /** How far the picture swings between the song's small and big moments. */
  swing: { live: number; score: number };
  presenceMatch: number;
}

/** Times something jumps above a level, for pulses that decay. */
function risesAbove(values: readonly number[], level: number, gapS = 0): number[] {
  const out: number[] = [];
  let armed = true;
  values.forEach((value, i) => {
    const time = i / RATE;
    if (armed && value >= level && (out.length === 0 || time - (out.at(-1) ?? 0) >= gapS)) {
      out.push(+time.toFixed(2));
      armed = false;
    } else if (value < level / 2) {
      armed = true;
    }
  });
  return out;
}

function matched(a: readonly number[], b: readonly number[], tolerance: number): number {
  const used = new Set<number>();
  let count = 0;
  for (const time of a) {
    const hit = b.findIndex((other, i) => !used.has(i) && Math.abs(other - time) <= tolerance);
    if (hit >= 0) {
      used.add(hit);
      count++;
    }
  }
  return count;
}

/** The part of a signal that moves faster than its own running average. */
function punch(values: readonly number[]): number {
  let slow = values[0] ?? 0;
  let sum = 0;
  const follow = 1 - Math.exp(-1 / (RATE * PUNCH_WINDOW_S));
  for (const value of values) {
    slow += (value - slow) * follow;
    sum += (value - slow) ** 2;
  }
  return +Math.sqrt(sum / Math.max(1, values.length)).toFixed(3);
}

/** How far a slow average of a signal moves across the song. */
function swing(values: readonly number[]): number {
  const window = RATE * 4;
  const averages: number[] = [];
  let sum = 0;
  values.forEach((value, i) => {
    sum += value;
    if (i >= window) sum -= values[i - window] ?? 0;
    if (i >= window && i % 15 === 0) averages.push(sum / window);
  });
  averages.sort((a, b) => a - b);
  const at = (share: number) => averages[Math.floor(averages.length * share)] ?? 0;
  return +(at(0.95) - at(0.05)).toFixed(3);
}

function correlation(a: readonly number[], b: readonly number[], from: number): number {
  let n = 0;
  let sa = 0;
  let sb = 0;
  let aa = 0;
  let bb = 0;
  let ab = 0;
  for (let i = from; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    n++;
    sa += x;
    sb += y;
    aa += x * x;
    bb += y * y;
    ab += x * y;
  }
  const spread = Math.sqrt((aa - (sa * sa) / n) * (bb - (sb * sb) / n));
  return spread > 1e-9 ? +((ab - (sa * sb) / n) / spread).toFixed(2) : 0;
}

export async function benchSong(file: Blob, name: string): Promise<LiveReport> {
  const clean = await withoutCoverArt(new File([file], name));
  const decoder = new OfflineAudioContext(2, 1, 48000);
  const buffer = await decoder.decodeAudioData(await clean.arrayBuffer());
  const score = await scoreFromMix(buffer);

  const seconds = Math.min(LIMIT_S, buffer.duration - 1);
  const rate = buffer.sampleRate;
  const ctx = new OfflineAudioContext(2, Math.floor(rate * seconds), rate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.35;
  const pitch = ctx.createAnalyser();
  pitch.fftSize = PITCH_FFT_SIZE;
  pitch.smoothingTimeConstant = 0;
  for (const node of [analyser, pitch]) {
    node.minDecibels = MIN_DECIBELS;
    node.maxDecibels = MAX_DECIBELS;
    source.connect(node);
  }
  source.connect(ctx.destination);
  source.start();

  const bands = () => new Float32Array(6).fill(1);
  const live = new FeatureExtractor(rate, bands());
  const scored = new FeatureExtractor(rate, bands());
  live.reset(false);
  scored.reset(false);
  const a = createAudioFeatures();
  const b = createAudioFeatures();
  const player = new ScorePlayer();
  const record = {
    liveEnergy: [] as number[],
    scoreEnergy: [] as number[],
    livePresence: [] as number[],
    scorePresence: [] as number[],
    liveImpact: [] as number[],
    liveKick: [] as number[],
  };
  const dt = 1 / RATE;
  let time = dt;
  const step = () => {
    live.update(analyser, pitch, dt, a);
    scored.update(analyser, pitch, dt, b);
    b.presence = 1;
    b.dropPower = 1;
    b.tension = 0;
    b.hang = 0;
    b.world = 0;
    player.apply(score, time, b);
    record.liveEnergy.push(a.energy);
    record.scoreEnergy.push(b.energy);
    record.livePresence.push(a.presence);
    record.scorePresence.push(b.presence);
    record.liveImpact.push(a.impact);
    record.liveKick.push(a.kick);
    time += dt;
    if (time < seconds - 0.05) void ctx.suspend(time).then(step);
    void ctx.resume();
  };
  void ctx.suspend(time).then(step);
  await ctx.startRendering();

  const realDrops = Array.from(score.drops).filter((drop) => drop <= seconds);
  const liveDrops = risesAbove(record.liveImpact, 0.5, 2);
  const found = matched(realDrops, liveDrops, DROP_TOLERANCE_S);
  const realKicks = Array.from(score.hits.kick).filter((kick) => kick <= seconds);
  const liveKicks = risesAbove(record.liveKick, 0.6);
  const hits = matched(liveKicks, realKicks, KICK_TOLERANCE_S);
  const precision = hits / Math.max(1, liveKicks.length);
  const recall = hits / Math.max(1, realKicks.length);

  return {
    name,
    seconds: Math.round(seconds),
    bpm: Math.round(score.bpm),
    drops: {
      real: realDrops.map((drop) => +drop.toFixed(1)),
      live: liveDrops,
      found,
      extra: liveDrops.length - found,
    },
    kicks: {
      real: realKicks.length,
      live: liveKicks.length,
      f1: +((2 * precision * recall) / Math.max(0.001, precision + recall)).toFixed(2),
    },
    punch: { live: punch(record.liveEnergy), score: punch(record.scoreEnergy) },
    swing: { live: swing(record.livePresence), score: swing(record.scorePresence) },
    presenceMatch: correlation(record.livePresence, record.scorePresence, RATE * SETTLED_S),
  };
}
