/**
 * Measures how much the live analysis moves when the same music arrives quieter, as it does
 * from a streaming app (normalised to about -14 LUFS, then turned down further by its own
 * volume slider). In the dev server's console, with an audio file as a Blob:
 *
 *   (await import('/src/dev/levelBench.ts')).benchLevels(blob, 'name').then(console.table)
 */
import { withoutCoverArt } from '../audio/flac';
import { FeatureExtractor } from '../audio/featureExtractor';
import { createAudioFeatures, FFT_SIZE, PITCH_FFT_SIZE } from '../audio/features';
import { InputLeveller } from '../audio/inputLevel';
import { MAX_DECIBELS, MIN_DECIBELS } from '../audio/tone';

const RATE = 60;

export interface LevelReport {
  gainDb: number;
  levelled: boolean;
  level: number;
  energy: number;
  vocal: number;
  /** How much of the time the melody line is drawn at all. */
  lineShown: number;
  notes: number;
  kicks: number;
  snares: number;
  bands: string;
}

async function run(
  buffer: AudioBuffer,
  from: number,
  seconds: number,
  gainDb: number,
  levelled: boolean,
): Promise<LevelReport> {
  const rate = buffer.sampleRate;
  const ctx = new OfflineAudioContext(2, Math.floor(rate * seconds), rate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const input = ctx.createGain();
  input.gain.value = 10 ** (gainDb / 20);
  const level = ctx.createGain();
  source.connect(input).connect(level);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.35;
  const pitch = ctx.createAnalyser();
  pitch.fftSize = PITCH_FFT_SIZE;
  pitch.smoothingTimeConstant = 0;
  for (const node of [analyser, pitch]) {
    node.minDecibels = MIN_DECIBELS;
    node.maxDecibels = MAX_DECIBELS;
    level.connect(node);
  }
  level.connect(ctx.destination);
  source.start(0, from);

  const extractor = new FeatureExtractor(rate, new Float32Array(6).fill(1));
  extractor.reset(false);
  const leveller = new InputLeveller();
  const out = createAudioFeatures();
  const sums = { level: 0, energy: 0, vocal: 0, shown: 0, bands: new Float32Array(6) };
  let frames = 0;
  const dt = 1 / RATE;
  let time = dt;
  const samples = new Float32Array(FFT_SIZE);
  const step = () => {
    if (levelled) {
      analyser.getFloatTimeDomainData(samples);
      level.gain.value = leveller.update(samples, level.gain.value, dt);
    }
    extractor.update(analyser, pitch, dt, out);
    frames++;
    sums.level += out.level;
    sums.energy += out.energy;
    sums.vocal += out.vocal;
    if (out.vocal > 0.08) sums.shown++;
    out.bands.forEach((band, i) => (sums.bands[i] = (sums.bands[i] ?? 0) + band));
    time += dt;
    if (time < seconds - 0.05) void ctx.suspend(time).then(step);
    void ctx.resume();
  };
  void ctx.suspend(time).then(step);
  await ctx.startRendering();

  const mean = (sum: number) => +(sum / frames).toFixed(3);
  return {
    gainDb,
    levelled,
    level: mean(sums.level),
    energy: mean(sums.energy),
    vocal: mean(sums.vocal),
    lineShown: mean(sums.shown),
    notes: out.noteCount,
    kicks: 0,
    snares: out.snareCount,
    bands: Array.from(sums.bands, (sum) => (sum / frames).toFixed(2)).join(' '),
  };
}

export async function benchLevels(
  file: Blob,
  name: string,
  gains: readonly number[] = [0, -14, -26],
  from = 40,
  seconds = 40,
): Promise<LevelReport[]> {
  const clean = await withoutCoverArt(new File([file], name));
  const decoder = new OfflineAudioContext(2, 1, 48000);
  const buffer = await decoder.decodeAudioData(await clean.arrayBuffer());
  const reports: LevelReport[] = [];
  for (const gain of gains) {
    reports.push(await run(buffer, from, seconds, gain, false));
    if (gain !== 0) reports.push(await run(buffer, from, seconds, gain, true));
  }
  return reports;
}

/** How well a live reading of the tune agrees with what the whole-song score found. */
export async function benchMelody(file: Blob, name: string, from = 40, seconds = 40) {
  const { scoreFromMix } = await import('../audio/score/loadScore');
  const { SCORE_RATE } = await import('../audio/score/sections');
  const { LiveMelody } = await import('../audio/liveMelody');
  const clean = await withoutCoverArt(new File([file], name));
  const decoder = new OfflineAudioContext(2, 1, 48000);
  const buffer = await decoder.decodeAudioData(await clean.arrayBuffer());
  const score = await scoreFromMix(buffer);
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
  source.start(0, from);
  const extractor = new FeatureExtractor(rate, new Float32Array(6).fill(1));
  extractor.reset(false);
  const out = createAudioFeatures();
  const melody = new LiveMelody(rate, PITCH_FFT_SIZE);
  const spectrum = new Uint8Array(PITCH_FFT_SIZE / 2);
  const tally = { voiced: 0, exact: 0, octave: 0, oldOctave: 0, levelIn: 0, levelOut: 0, out: 0 };
  tally.oldOctave = 0;
  let oldExact = 0;
  const clarIn: number[] = [];
  const clarOut: number[] = [];
  let vocalIn = 0;
  let vocalOut = 0;
  const dt = 1 / RATE;
  let time = dt;
  const step = () => {
    extractor.update(analyser, pitch, dt, out);
    pitch.getByteFrequencyData(spectrum);
    melody.update(spectrum, dt, out.gate > 0.3);
    const frame = Math.round((from + time - 2048 / rate) * SCORE_RATE);
    const real = score.melody[frame] ?? 0;
    const sung = (score.melodyLevel[frame] ?? 0) > 0.3 && real > 0;
    if (sung) {
      tally.voiced++;
      const apart = Math.abs(melody.note - real);
      if (apart <= 1) tally.exact++;
      const folded = Math.abs(((melody.note - real + 600) % 12) - 0);
      if (Math.min(folded, 12 - folded) <= 1) tally.octave++;
      const old = 55 + out.melody * 36;
      if (Math.abs(old - real) <= 1) oldExact++;
      tally.levelIn += melody.level;
      clarIn.push(melody.clarity);
      vocalIn += out.vocal;
    } else {
      tally.out++;
      tally.levelOut += melody.level;
      clarOut.push(melody.clarity);
      vocalOut += out.vocal;
    }
    time += dt;
    if (time < seconds - 0.05) void ctx.suspend(time).then(step);
    void ctx.resume();
  };
  void ctx.suspend(time).then(step);
  await ctx.startRendering();
  const share = (count: number, of: number) => +(count / Math.max(1, of)).toFixed(2);
  return {
    name: name.slice(0, 24),
    sung: share(tally.voiced, tally.voiced + tally.out),
    exact: share(tally.exact, tally.voiced),
    rightNote: share(tally.octave, tally.voiced),
    oldExact: share(oldExact, tally.voiced),
    levelSung: share(tally.levelIn, tally.voiced),
    levelRest: share(tally.levelOut, tally.out),
    oldLevelSung: share(vocalIn, tally.voiced),
    oldLevelRest: share(vocalOut, tally.out),
    clarity: [clarIn, clarOut].map((list) => {
      list.sort((a, b) => a - b);
      return [0.1, 0.5, 0.9].map((q) => +(list[Math.floor(list.length * q)] ?? 0).toFixed(1));
    }),
  };
}

/**
 * Whether live sound alone can say how far lyrics are out. Lyrics are moved by known amounts,
 * then fitted back against the live reading of the voice and, for comparison, the score's.
 */
export async function benchLyricFit(file: Blob, name: string, title: string, artist: string) {
  const { scoreFromMix } = await import('../audio/score/loadScore');
  const { SCORE_RATE } = await import('../audio/score/sections');
  const { findLyrics } = await import('../lyrics/lookup');
  const { parseLyrics, shifted } = await import('../lyrics/lrc');
  const { lyricShift } = await import('../lyrics/align');
  const clean = await withoutCoverArt(new File([file], name));
  const decoder = new OfflineAudioContext(2, 1, 48000);
  const buffer = await decoder.decodeAudioData(await clean.arrayBuffer());
  const found = await findLyrics({ title, artist, duration: buffer.duration });
  if (!found) return { name, lyrics: false };
  const seconds = Math.min(110, buffer.duration - 1);
  const lines = parseLyrics(found.lrc).filter((line) => line.time < seconds - 5);
  const score = await scoreFromMix(buffer);

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
  const extractor = new FeatureExtractor(rate, new Float32Array(6).fill(1));
  extractor.reset(false);
  const out = createAudioFeatures();
  const live = new Float32Array(Math.ceil(seconds * RATE));
  const dt = 1 / RATE;
  let time = dt;
  let frame = 0;
  const step = () => {
    extractor.update(analyser, pitch, dt, out);
    live[frame++] = out.vocal;
    time += dt;
    if (time < seconds - 0.05) void ctx.suspend(time).then(step);
    void ctx.resume();
  };
  void ctx.suspend(time).then(step);
  await ctx.startRendering();

  const voice = score.voice.subarray(0, Math.floor(seconds * SCORE_RATE));
  const tries = [-6, -3.5, 3, 5.5, 9].map((moved) => ({
    moved,
    live: lyricShift(shifted(lines, -moved), live, RATE, moved),
    score: lyricShift(shifted(lines, -moved), voice, SCORE_RATE, moved),
  }));
  return {
    name: name.slice(0, 22),
    lines: lines.length,
    same: found.duration,
    is: buffer.duration,
    tries,
  };
}
