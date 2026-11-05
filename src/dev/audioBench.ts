/**
 * Offline regression bench for the audio analysis (dev only; never imported by the app).
 * It runs the real AnalyserNodes and FeatureExtractor inside an OfflineAudioContext, stepping
 * at 60 Hz with suspend(), so results don't depend on the tab being visible or the frame
 * rate. Every signal has a known right answer. In the dev server's console:
 *
 *   (await import('/src/dev/audioBench.ts')).runAudioBench().then(console.table)
 */
import { FeatureExtractor } from '../audio/featureExtractor';
import {
  type AudioFeatures,
  createAudioFeatures,
  FFT_SIZE,
  PITCH_FFT_SIZE,
} from '../audio/features';
import {
  clap,
  createNoise,
  hat,
  kick,
  midiToHz,
  type Rig,
  snare,
  sub,
} from '../audio/synth/instruments';
import { PATTERNS, type PatternId } from '../audio/synth/patterns';
import { VIBES } from '../audio/mood';
import { scoreFromMix, scoreFromStems } from '../audio/score/loadScore';
import type { Score } from '../audio/score/score';
import { bass, drums, emptyMix, master, MIX_BAR, pad, riff } from './testMixes';
import { renderProofSong } from '../audio/synth/proofSong';
import { moodOf } from '../scene/AutoDirector';
import { chordOf, harmonicCentre } from '../scene/harmony';
import { MAX_DECIBELS, MIN_DECIBELS } from '../audio/tone';

const SAMPLE_RATE = 48000;
const DT = 1 / 60;

type Sampler = (features: AudioFeatures, time: number) => void;

async function analyse(
  seconds: number,
  live: boolean,
  build: (rig: Rig) => void,
  sample: Sampler,
): Promise<void> {
  const ctx = new OfflineAudioContext(1, SAMPLE_RATE * seconds, SAMPLE_RATE);
  const out = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.35;
  const pitch = ctx.createAnalyser();
  pitch.fftSize = PITCH_FFT_SIZE;
  pitch.smoothingTimeConstant = 0;
  for (const node of [analyser, pitch]) {
    node.minDecibels = MIN_DECIBELS;
    node.maxDecibels = MAX_DECIBELS;
    out.connect(node);
  }
  out.connect(ctx.destination);
  build({ ctx, out, noise: createNoise(ctx, 2) });

  const extractor = new FeatureExtractor(SAMPLE_RATE, new Float32Array(6).fill(1));
  extractor.reset(live);
  const features = createAudioFeatures();
  let time = DT;
  const step = () => {
    extractor.update(analyser, pitch, DT, features);
    sample(features, time);
    time += DT;
    if (time < seconds - 0.05) void ctx.suspend(time).then(step);
    void ctx.resume();
  };
  void ctx.suspend(time).then(step);
  await ctx.startRendering();
}

function loopNoise(rig: Rig, gain: number, lowpassHz: number): GainNode {
  const source = rig.ctx.createBufferSource();
  source.buffer = rig.noise;
  source.loop = true;
  const filter = rig.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = lowpassHz;
  const level = rig.ctx.createGain();
  level.gain.value = gain;
  source.connect(filter).connect(level).connect(rig.out);
  source.start();
  return level;
}

/** A piano-ish note: harmonics with a sharp attack and long decay. */
function note(rig: Rig, time: number, midi: number, peak: number, length = 1.4): void {
  [1, 2, 3, 4].forEach((harmonic, i) => {
    const osc = rig.ctx.createOscillator();
    osc.frequency.value = midiToHz(midi) * harmonic;
    const env = rig.ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(peak / (i + 1) ** 1.5, time + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, time + length);
    osc.connect(env).connect(rig.out);
    osc.start(time);
    osc.stop(time + length + 0.05);
  });
}

/** Where the tracker thinks it is when a real beat lands: above 0 means it called the beat early. */
const signedPhase = (phase: number) => (phase > 0.5 ? phase - 1 : phase);
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

export interface BenchRow {
  test: string;
  expected: string;
  measured: string;
}

async function roomNoise(): Promise<BenchRow> {
  const levels: number[] = [];
  let beats = 0;
  let start = 0;
  await analyse(
    12,
    true,
    (rig) => loopNoise(rig, 0.02, 2500),
    (f, t) => {
      if (t < 6) start = f.beatCount;
      else levels.push(f.level);
      beats = f.beatCount - start;
    },
  );
  return {
    test: 'Mic: quiet room fan',
    expected: 'level ~0, no beats',
    measured: `level ${round(mean(levels), 3)}, ${beats} beats`,
  };
}

async function clapInRoom(): Promise<BenchRow> {
  let hits = 0;
  let last = 0;
  await analyse(
    10,
    true,
    (rig) => {
      loopNoise(rig, 0.02, 2500);
      for (const time of [5, 6.5, 8]) clap(rig, time, 0.6);
    },
    (f, t) => {
      if (t > 4.5 && f.beatCount !== last) hits++;
      last = f.beatCount;
    },
  );
  return { test: 'Mic: 3 claps in that room', expected: '3 beats', measured: `${hits} beats` };
}

async function quietThenDrop(): Promise<BenchRow> {
  const quiet: number[] = [];
  const loud: number[] = [];
  await analyse(
    26,
    false,
    (rig) => {
      for (let time = 0; time < 26; time += 0.5) {
        const peak = time < 13 ? 0.03 : 0.9;
        kick(rig, time, peak);
        note(rig, time + 0.25, 57, peak * 0.3, 0.3);
      }
    },
    (f, t) => {
      if (t > 8 && t < 13) quiet.push(Math.max(...f.bands));
      if (t > 16) loud.push(Math.max(...f.bands));
    },
  );
  return {
    test: 'Quiet intro, then drop (+30 dB)',
    expected: 'drop far bigger',
    measured: `peak band ${round(Math.max(...quiet))} → ${round(Math.max(...loud))}`,
  };
}

async function drumSplit(): Promise<BenchRow> {
  const beat = 60 / 100;
  const kicks: number[] = [];
  const snares: number[] = [];
  const hits = { kick: [] as number[], snare: [] as number[] };
  let previousKick = 0;
  let previousSnare = 0;
  await analyse(
    16,
    false,
    (rig) => {
      for (let i = 0; i < 24; i++) {
        const time = 0.5 + i * beat;
        if (i % 2 === 0) {
          kick(rig, time);
          kicks.push(time);
        } else {
          snare(rig, time, 0.6);
          snares.push(time);
        }
        hat(rig, time + beat / 2, 0.12);
      }
    },
    (f, t) => {
      if (f.kick > previousKick + 0.2) hits.kick.push(t);
      if (f.snare > previousSnare + 0.2) hits.snare.push(t);
      previousKick = f.kick;
      previousSnare = f.snare;
    },
  );
  const near = (list: number[], time: number) => list.some((x) => Math.abs(x - time) < 0.09);
  const after = (list: number[]) => list.filter((t) => t > 2.5);
  const kicksFound = after(kicks).filter((t) => near(hits.kick, t)).length;
  const snaresFound = after(snares).filter((t) => near(hits.snare, t)).length;
  const kickOnSnare = after(snares).filter((t) => near(hits.kick, t)).length;
  const snareOnKick = after(kicks).filter((t) => near(hits.snare, t)).length;
  return {
    test: 'Kick/snare groove, 100 BPM',
    expected: 'each channel finds its own',
    measured: `kick ${kicksFound}/${after(kicks).length} (on snares ${kickOnSnare}), snare ${snaresFound}/${after(snares).length} (on kicks ${snareOnKick})`,
  };
}

async function tempoOf(id: PatternId): Promise<BenchRow> {
  const pattern = PATTERNS[id];
  const step = 60 / pattern.bpm / 4;
  const loop = pattern.bars * 16 * step;
  let bpm = 0;
  let confidence = 0;
  const phaseError: number[] = [];
  await analyse(
    Math.min(loop, 16),
    false,
    (rig) => pattern.schedule(rig, step),
    (f, t) => {
      bpm = f.bpm;
      confidence = f.tempoConfidence;
      if (t < 10) return;
      const beats = t / (step * 4);
      if (Math.abs(beats - Math.round(beats)) < 0.5 * (DT / (step * 4)) + 1e-6) {
        phaseError.push(signedPhase(f.beatPhase));
      }
    },
  );
  return {
    test: `Tempo: ${id}`,
    expected: `${pattern.bpm} BPM, phase offset near 0`,
    measured: `${round(bpm, 1)} BPM, confidence ${round(confidence)}, phase offset ${round(mean(phaseError))}`,
  };
}

/** Records when each drum channel fired, ignoring the first seconds while detectors settle. */
function hitLog(settle = 2.5) {
  const hits = { kick: [] as number[], snare: [] as number[] };
  let previousKick = 0;
  let previousSnare = 0;
  return {
    hits,
    sample(f: AudioFeatures, t: number) {
      if (t > settle && f.kick > previousKick + 0.2) hits.kick.push(t);
      if (t > settle && f.snare > previousSnare + 0.2) hits.snare.push(t);
      previousKick = f.kick;
      previousSnare = f.snare;
    },
    /** How many of `times` have a hit within reach. */
    found(list: number[], times: number[]) {
      return times.filter((time) => list.some((x) => Math.abs(x - time) < 0.09)).length;
    },
  };
}

const settled = (times: number[]) => times.filter((t) => t > 2.8);

/** Pop and house: the kick never stops, and a clap lands on top of it on 2 and 4. */
async function layeredBackbeat(): Promise<BenchRow> {
  const log = hitLog();
  const beat = 0.5;
  const kicks: number[] = [];
  const backbeats: number[] = [];
  const plain: number[] = [];
  await analyse(
    14,
    false,
    (rig) => {
      for (let i = 0; i < 26; i++) {
        const t = 0.4 + i * beat;
        kick(rig, t, 0.95);
        kicks.push(t);
        (i % 2 === 1 ? backbeats : plain).push(t);
        if (i % 2 === 1) clap(rig, t);
        hat(rig, t + beat / 2, 0.1);
      }
    },
    log.sample,
  );
  return {
    test: 'Kick + clap layered on 2 and 4',
    expected: 'kicks all, snare on backbeats only',
    measured: `kick ${log.found(log.hits.kick, settled(kicks))}/${settled(kicks).length}, snare on backbeats ${log.found(log.hits.snare, settled(backbeats))}/${settled(backbeats).length}, on plain kicks ${log.found(log.hits.snare, settled(plain))}`,
  };
}

/** A beater transient: short, bright and far quieter than the thump underneath it. */
function beaterClick(rig: Rig, t: number, peak: number): void {
  const filter = rig.ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2400;
  filter.Q.value = 0.9;
  const env = rig.ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + 0.001);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
  const source = rig.ctx.createBufferSource();
  source.buffer = rig.noise;
  source.connect(filter).connect(env).connect(rig.out);
  source.start(t, (t * 5.13) % 0.5);
  source.stop(t + 0.03);
}

/** Hip-hop kicks are mostly thump, but the click is what cuts through. */
async function clickyKick(): Promise<BenchRow> {
  const log = hitLog();
  const kicks: number[] = [];
  const snares: number[] = [];
  await analyse(
    14,
    false,
    (rig) => {
      for (let i = 0; i < 20; i++) {
        const t = 0.4 + i * 0.65;
        if (i % 2 === 0) {
          kick(rig, t, 0.95);
          beaterClick(rig, t, 0.4);
          kicks.push(t);
        } else {
          snare(rig, t, 0.55);
          snares.push(t);
        }
      }
    },
    log.sample,
  );
  return {
    test: 'Kick with a beater click',
    expected: 'click stays a kick',
    measured: `kick ${log.found(log.hits.kick, settled(kicks))}/${settled(kicks).length}, snare on kicks ${log.found(log.hits.snare, settled(kicks))}, snare ${log.found(log.hits.snare, settled(snares))}/${settled(snares).length}`,
  };
}

/** Trap: a long 808 sits under the snare, and its own start is a low hit. */
async function eightOhEight(): Promise<BenchRow> {
  const log = hitLog();
  const snares: number[] = [];
  const starts: number[] = [];
  await analyse(
    14,
    false,
    (rig) => {
      for (let bar = 0; bar < 7; bar++) {
        const t = 0.4 + bar * 1.8;
        sub(rig, t, 31, 1.7, 0.75);
        starts.push(t);
        for (const offset of [0.45, 1.35]) {
          snare(rig, t + offset, 0.5);
          snares.push(t + offset);
        }
      }
    },
    log.sample,
  );
  return {
    test: 'Snare over a sustained 808',
    expected: 'every snare; no kicks from the sustain',
    measured: `snare ${log.found(log.hits.snare, settled(snares))}/${settled(snares).length}, kicks not on an 808 start ${log.hits.kick.filter((t) => !starts.some((s) => Math.abs(s - t) < 0.15)).length}`,
  };
}

/** Sparse off-grid kicks over a steady backbeat: the pulse lives in the snare and hats. */
async function syncopated(bpm: number, name: string, kickSteps: number[]): Promise<BenchRow> {
  const step = 60 / bpm / 4;
  let tempo = 0;
  let confidence = 0;
  const offBeat: number[] = [];
  await analyse(
    16,
    false,
    (rig) => {
      for (let i = 0; i * step < 16; i++) {
        const t = 0.2 + i * step;
        const s = i % 16;
        if (kickSteps.includes(s)) kick(rig, t, 0.9);
        if (s === 4 || s === 12) snare(rig, t, 0.5);
        if (s % 2 === 0) hat(rig, t, 0.09);
      }
    },
    (f, t) => {
      tempo = f.bpm;
      confidence = f.tempoConfidence;
      if (t < 10) return;
      const beats = (t - 0.2) / (step * 4);
      const nearBeat = Math.abs(beats - Math.round(beats)) < 0.5 * (DT / (step * 4)) + 1e-6;
      if (nearBeat) offBeat.push(signedPhase(f.beatPhase));
    },
  );
  return {
    test: `Tempo: ${name}`,
    expected: `${bpm} BPM, phase offset near 0`,
    measured: `${round(tempo, 1)} BPM, confidence ${round(confidence)}, phase offset ${round(mean(offBeat))}`,
  };
}

async function hatRoll(): Promise<BenchRow> {
  const step = 60 / 140 / 8;
  let start = 0;
  let end = 0;
  const hits = 72;
  await analyse(
    10,
    false,
    (rig) => {
      for (let i = 0; i < 16; i++) hat(rig, 0.3 + i * 0.25, 0.12);
      for (let i = 0; i < hits; i++) hat(rig, 5 + i * step, 0.12);
    },
    (f, t) => {
      if (t < 4.95) start = f.hatCount;
      if (t < 5 + hits * step + 0.1) end = f.hatCount;
    },
  );
  return {
    test: 'Trap hat roll, 32nds at 140 BPM',
    expected: `${hits} hits`,
    measured: `${end - start} detected`,
  };
}

/** Crisp hats tucked under a mix: too quiet to lift the treble band, but plainly audible. */
async function quietHats(): Promise<BenchRow> {
  let start = 0;
  let end = 0;
  let treble = 0;
  let frames = 0;
  await analyse(
    10,
    false,
    (rig) => {
      loopNoise(rig, 0.05, 1500);
      for (let i = 0; i < 40; i++) {
        if (i % 4 === 0) kick(rig, 0.3 + i * 0.25, 0.9);
        hat(rig, 0.3 + i * 0.25, 0.035);
      }
    },
    (f, t) => {
      if (t < 3) start = f.hatCount;
      else {
        end = f.hatCount;
        treble += f.bands[5] ?? 0;
        frames++;
      }
    },
  );
  return {
    test: 'Quiet hats under a mix',
    expected: '~28 hits',
    measured: `${end - start} detected, mean treble band ${round(treble / Math.max(1, frames))}`,
  };
}

/** A sung-range melody should read as a voice; a drum loop and a noise wall shouldn't. */
async function vocalPresence(): Promise<BenchRow> {
  const measure = async (build: (rig: Rig) => void) => {
    const values: number[] = [];
    await analyse(8, false, build, (f, t) => {
      if (t > 3) values.push(f.vocal);
    });
    return round(mean(values));
  };
  const melody = await measure((rig) => {
    for (let i = 0; i < 16; i++) note(rig, 0.2 + i * 0.5, 72 + ((i * 5) % 12), 0.3, 0.9);
  });
  const drums = await measure((rig) => {
    for (let i = 0; i < 16; i++) {
      kick(rig, 0.2 + i * 0.5, 0.9);
      if (i % 2 === 1) snare(rig, 0.2 + i * 0.5, 0.5);
      hat(rig, 0.45 + i * 0.5, 0.12);
    }
  });
  const noise = await measure((rig) => {
    loopNoise(rig, 0.25, 6000);
  });
  return {
    test: 'Vocal presence',
    expected: 'melody above drums, noise near 0',
    measured: `melody ${melody}, drums ${drums}, noise ${noise}`,
  };
}

/** Where the tracker puts the snares of a groove, and how it feels the tempo. */
async function barOf(
  name: string,
  bpm: number,
  kicks: number[],
  snares: number[],
): Promise<BenchRow> {
  const step = 60 / bpm / 4;
  const onSnare: number[] = [];
  let scale = 1;
  let confidence = 0;
  let felt = 0;
  await analyse(
    20,
    false,
    (rig) => {
      for (let i = 0; i * step < 20; i++) {
        const t = 0.2 + i * step;
        const s = i % 16;
        if (kicks.includes(s)) kick(rig, t, 0.9);
        if (snares.includes(s)) snare(rig, t, 0.5);
        if (s % 2 === 0) hat(rig, t, 0.09);
      }
    },
    (f, t) => {
      scale = f.grooveScale;
      confidence = f.barConfidence;
      felt = f.bpm * f.grooveScale;
      if (t < 14) return;
      const steps = (t - 0.2) / step;
      const near = Math.abs(steps - Math.round(steps)) < 0.5 * (DT / step) + 1e-6;
      if (near && snares.includes(Math.round(steps) % 16)) onSnare.push(f.barBeat + 1);
    },
  );
  const beats = [...new Set(onSnare)].sort().join(',');
  return {
    test: `Bar: ${name}`,
    expected: snares.length === 1 && bpm > 110 ? `felt near ${bpm / 2} BPM` : 'snares on backbeats',
    measured: `snare on beat ${beats}, scale ${scale}, felt ${round(felt, 0)} BPM, confidence ${round(confidence)}`,
  };
}

/** A groove, then the kick goes missing for two beats, then the drop. */
async function preDropBreath(): Promise<BenchRow> {
  const beat = 0.5;
  const dropAt = 0.3 + 22 * beat;
  let beforeGap = 0;
  let held = 0;
  let impact = 0;
  await analyse(
    13,
    false,
    (rig) => {
      for (let i = 0; i < 24; i++) {
        const t = 0.3 + i * beat;
        if (i < 20 || i >= 22) kick(rig, t, 0.95);
        if (i % 2 === 1) snare(rig, t, 0.5);
        hat(rig, t + beat / 2, 0.1);
      }
    },
    (f, t) => {
      if (t > 3 && t < dropAt - 1) beforeGap = Math.max(beforeGap, f.inhale);
      if (t > dropAt - 1 && t < dropAt + 0.05) held = Math.max(held, f.inhale);
      if (t > dropAt && t < dropAt + 0.3) impact = Math.max(impact, f.impact);
    },
  );
  return {
    test: 'Pre-drop breath',
    expected: 'held near 1, then impact; none before',
    measured: `before ${round(beforeGap)}, held ${round(held)}, impact ${round(impact)}`,
  };
}

/** False alarms: grooves whose kicks are sparse or uneven should never read as a held breath. */
async function steadyBreath(name: string, bpm: number, kicks: number[]): Promise<BenchRow> {
  const step = 60 / bpm / 4;
  let peak = 0;
  const times: number[] = [];
  await analyse(
    14,
    false,
    (rig) => {
      for (let i = 0; i * step < 14; i++) {
        const t = 0.2 + i * step;
        if (kicks.includes(i % 16)) kick(rig, t, 0.9);
        if (i % 16 === 4 || i % 16 === 12) snare(rig, t, 0.5);
        if (i % 2 === 0) hat(rig, t, 0.09);
      }
    },
    (f, t) => {
      if (t < 2) return;
      peak = Math.max(peak, f.inhale);
      if (f.inhale > 0.3) times.push(t);
    },
  );
  const first = times[0] ?? 0;
  const last = times[times.length - 1] ?? 0;
  return {
    test: `No false breath: ${name}`,
    expected: 'near 0',
    measured: `peak ${round(peak)}, held ${round(times.length * DT)} s, from ${round(first, 1)} to ${round(last, 1)} s`,
  };
}

async function barOfPattern(id: PatternId): Promise<BenchRow> {
  const pattern = PATTERNS[id];
  const step = 60 / pattern.bpm / 4;
  let confidence = 0;
  let scale = 1;
  const onOne: number[] = [];
  await analyse(
    Math.min(pattern.bars * 16 * step, 16),
    false,
    (rig) => pattern.schedule(rig, step),
    (f, t) => {
      confidence = f.barConfidence;
      scale = f.grooveScale;
      if (t < 10) return;
      const bars = t / (step * 16);
      if (Math.abs(bars - Math.round(bars)) < 0.5 * (DT / (step * 16)) + 1e-6)
        onOne.push(f.barBeat);
    },
  );
  return {
    test: `Bar: ${id} demo`,
    expected: 'finds the bar',
    measured: `confidence ${round(confidence)}, scale ${scale}, true 1 reads as beat ${[...new Set(onOne)].map((b) => b + 1).join(',')}`,
  };
}

async function vibeOfPattern(id: PatternId): Promise<BenchRow> {
  const pattern = PATTERNS[id];
  const step = 60 / pattern.bpm / 4;
  let f0 = { arousal: 0, brightness: 0, vibe: 0 };
  let mood = '';
  await analyse(
    16,
    false,
    (rig) => pattern.schedule(rig, step),
    (f) => {
      f0 = { arousal: f.arousal, brightness: f.brightness, vibe: f.vibe };
      mood = moodOf(f);
    },
  );
  return {
    test: `Vibe: ${id}`,
    expected: 'matches the track',
    measured: `${VIBES[f0.vibe]}, show mood ${mood}, arousal ${round(f0.arousal)}, brightness ${round(f0.brightness)}`,
  };
}

const CHORDS: readonly { name: string; root: number; minor: boolean; notes: number[] }[] = [
  { name: 'C', root: 0, minor: false, notes: [60, 64, 67] },
  { name: 'Am', root: 9, minor: true, notes: [57, 60, 64] },
  { name: 'F', root: 5, minor: false, notes: [53, 57, 60] },
  { name: 'G', root: 7, minor: false, notes: [55, 59, 62] },
  { name: 'Dm', root: 2, minor: true, notes: [50, 53, 57] },
  { name: 'Em7', root: 4, minor: true, notes: [52, 55, 59, 62] },
  { name: 'Cmaj9', root: 0, minor: false, notes: [48, 52, 55, 59, 62] },
  { name: 'Am9', root: 9, minor: true, notes: [45, 48, 52, 55, 59] },
  { name: 'Fm7', root: 5, minor: true, notes: [53, 56, 60, 63] },
  { name: 'B♭7', root: 10, minor: false, notes: [46, 50, 53, 56] },
];

/** Reads each chord two ways: thirds around the loudest note, and matching whole triads. */
async function chords(): Promise<BenchRow> {
  const hold = 2;
  const seen: { chroma: number[]; pitch: number }[] = [];
  await analyse(
    CHORDS.length * hold + 0.2,
    false,
    (rig) => {
      CHORDS.forEach((chord, i) => {
        for (const midi of chord.notes) note(rig, i * hold, midi, 0.16, hold + 0.3);
      });
    },
    (f, t) => {
      const i = Math.floor(t / hold);
      if (t - i * hold > 1.6 && t - i * hold < 1.62) {
        seen[i] = { chroma: [...f.chroma], pitch: f.pitchClass };
      }
    },
  );
  let viaLoudest = 0;
  let viaTriads = 0;
  let roots = 0;
  const wrong: string[] = [];
  const centres: { x: number; y: number }[] = [];
  CHORDS.forEach((chord, i) => {
    const heard = seen[i];
    if (!heard) return;
    const c = heard.chroma;
    const p = heard.pitch;
    if ((c[(p + 3) % 12] ?? 0) > (c[(p + 4) % 12] ?? 0) === chord.minor) viaLoudest++;
    const triad = chordOf(c);
    if (triad.colour < 0 === chord.minor) viaTriads++;
    else wrong.push(chord.name);
    if (triad.root === chord.root) roots++;
    centres.push(harmonicCentre(c));
  });
  let nearest = Infinity;
  centres.forEach((a, i) => {
    centres.forEach((b, j) => {
      if (j > i) nearest = Math.min(nearest, Math.hypot(a.x - b.x, a.y - b.y));
    });
  });
  return {
    test: 'Chords',
    expected: 'major or minor, and the root',
    measured: `quality via loudest note ${viaLoudest}/${CHORDS.length}, via triads ${viaTriads}/${CHORDS.length}, roots ${roots}/${CHORDS.length}, wrong: ${wrong.join(' ') || 'none'}, closest chords ${round(nearest)} apart`,
  };
}

/** The whole-song pipeline, from true stems and from the bare mix, against what was written. */
async function songScore(): Promise<BenchRow[]> {
  const song = await renderProofSong();
  const describe = (score: Score) =>
    `${round(score.bpm, 1)} BPM at ${round(score.tempoConfidence)}, ${score.hits.kick.length} kicks, ${score.hits.snare.length} snares, drops at ${[...score.drops].map((d) => round(d, 1)).join(', ') || 'none'}, bar confidence ${round(score.barConfidence)}, melody ${round((100 * score.melody.filter((n) => n > 0).length) / score.melody.length)}% of frames`;
  return [
    {
      test: 'Song score: true stems',
      expected: '100 BPM, drops at 38.4 and 76.8',
      measured: describe(await scoreFromStems(song.stems, song.mix)),
    },
    {
      test: 'Song score: bare mix',
      expected: '100 BPM, drops at 38.4 and 76.8',
      measured: describe(await scoreFromMix(song.mix)),
    },
  ];
}

/** What the analysis reads from a finished mix, one part added at a time. */
async function voiceParts(): Promise<BenchRow[]> {
  const bars = MIX_BAR * 16;
  const parts: [string, (mix: Float32Array) => void, string][] = [
    ['drums and bass', () => undefined, 'nothing held, no notes'],
    ['plus pad', (mix) => pad(mix, 0, bars), 'clearly held, few notes'],
    ['plus riff', (mix) => riff(mix, 0, bars), 'clearly notes'],
  ];
  const rows: BenchRow[] = [];
  for (const [name, add, expected] of parts) {
    const mix = emptyMix(bars);
    drums(mix, 0, bars);
    bass(mix, 0, bars);
    add(mix);
    const score = await scoreFromMix(master(mix));
    const mean = (lane: Float32Array) => lane.reduce((sum, v) => sum + v, 0) / lane.length;
    rows.push({
      test: `Voices: ${name}`,
      expected,
      measured: `held ${round(mean(score.sustain))}, notes ${round(mean(score.notes))}, ${score.noteTimes.length} struck`,
    });
  }
  return rows;
}

/** Beats counted against the beats played, once the tracker has locked. */
async function beatCounter(): Promise<BenchRow> {
  const bpm = 124;
  let first = -1;
  let last = 0;
  let firstAt = 0;
  let lastAt = 0;
  const pattern = PATTERNS.pulse;
  const step = 60 / bpm / 4;
  await analyse(
    15.4,
    false,
    (rig) => pattern.schedule(rig, step),
    (f, t) => {
      if (t < 6) return;
      if (first < 0) {
        first = f.beatIndex;
        firstAt = t;
      }
      last = f.beatIndex;
      lastAt = t;
    },
  );
  return {
    test: 'Beat counter, 124 BPM',
    expected: `${Math.round(((lastAt - firstAt) * bpm) / 60)} beats`,
    measured: `${last - first} counted`,
  };
}

/** Debussy stand-in: free-time melody and chords, no drums. */
async function freeTimePiano(): Promise<BenchRow> {
  const melody = [60, 64, 67, 72, 69, 65, 62, 59, 64, 69, 72, 67];
  const times = [0.3, 1.2, 1.7, 3.1, 3.9, 5.4, 6.0, 7.6, 8.8, 9.3, 11, 12.4];
  const heard: number[] = [];
  let tempoConfidence = 0;
  let changes = 0;
  await analyse(
    15,
    false,
    (rig) => {
      melody.forEach((midi, i) => note(rig, times[i] ?? 0, midi, 0.3, 1.6));
    },
    (f, t) => {
      tempoConfidence = f.tempoConfidence;
      changes = f.harmonyCount;
      const index = times.findIndex((x) => t >= x + 0.3 && t < x + 0.34);
      if (index >= 0) heard[index] = f.pitchClass;
    },
  );
  const correct = melody.filter((midi, i) => heard[i] === midi % 12).length;
  return {
    test: 'Free-time piano, 12 notes',
    expected: '12 pitches, low tempo confidence',
    measured: `${correct}/12 pitches, ${changes} harmony changes, tempo confidence ${round(tempoConfidence)}`,
  };
}

/** Billie Eilish stand-in: sparse sub-bass under a breathy noise "whisper". */
async function subAndWhisper(): Promise<BenchRow> {
  const energy: number[] = [];
  await analyse(
    10,
    false,
    (rig) => {
      loopNoise(rig, 0.01, 7000);
      for (let time = 0.5; time < 10; time += 2) note(rig, time, 33, 0.5, 1.4);
    },
    (f, t) => {
      if (t > 3) energy.push(f.energy);
    },
  );
  return {
    test: 'Sub-bass and whisper',
    expected: 'clear swells',
    measured: `energy ${round(Math.min(...energy))}–${round(Math.max(...energy))}`,
  };
}

/** Meshuggah stand-in: dense distorted noise with hits on an odd 5/16 grouping. */
async function denseMetal(): Promise<BenchRow> {
  let beats = 0;
  let intensity = 0;
  let flatness = 0;
  await analyse(
    10,
    false,
    (rig) => {
      loopNoise(rig, 0.25, 6000);
      for (let i = 0; i < 90; i++) {
        const time = i * 0.1;
        if (i % 5 === 0) kick(rig, time, 0.9);
        if (i % 8 === 4) snare(rig, time, 0.5);
      }
    },
    (f) => {
      beats = f.beatCount;
      intensity = f.intensity;
      flatness = f.flatness;
    },
  );
  return {
    test: 'Dense metal, odd meter',
    expected: 'onsets survive noise wall',
    measured: `${beats} onsets in 10 s, intensity ${round(intensity)}, flatness ${round(flatness)}`,
  };
}

async function brightness(): Promise<BenchRow> {
  const measure = async (build: (rig: Rig) => void) => {
    let centroid = 0;
    let flatness = 0;
    await analyse(2, false, build, (f, t) => {
      // Mid-sound: at the end of a decay only the analyser's noise floor is left.
      if (t > 1 && t < 1.1) {
        centroid = f.centroid;
        flatness = f.flatness;
      }
    });
    return { centroid, flatness };
  };
  const cello = await measure((rig) => note(rig, 0, 40, 0.5, 3));
  const cymbal = await measure((rig) => {
    const source = rig.ctx.createBufferSource();
    source.buffer = rig.noise;
    source.loop = true;
    const filter = rig.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 3000;
    source.connect(filter).connect(rig.out);
    source.start();
  });
  return {
    test: 'Cello vs cymbal',
    expected: 'dark+tonal vs bright+noisy',
    measured: `centroid ${round(cello.centroid)} vs ${round(cymbal.centroid)}, flatness ${round(cello.flatness)} vs ${round(cymbal.flatness)}`,
  };
}

export async function runAudioBench(): Promise<BenchRow[]> {
  const rows: BenchRow[] = [];
  for (const test of [
    roomNoise,
    clapInRoom,
    quietThenDrop,
    drumSplit,
    layeredBackbeat,
    clickyKick,
    eightOhEight,
    hatRoll,
    quietHats,
    () => syncopated(120, 'pop, kick on every beat', [0, 4, 8, 12]),
    () => syncopated(100, 'rock, kick on 1 and 3', [0, 8]),
    () => syncopated(76, 'R&B, sparse kicks', [0, 3, 7, 10]),
    () => syncopated(140, 'trap, half-time kicks', [0, 6, 11]),
    beatCounter,
    vocalPresence,
    chords,
    () => barOf('backbeat, 100 BPM', 100, [0, 8, 10], [4, 12]),
    () => barOf('half-time trap, 140 BPM', 140, [0, 3, 10], [8]),
    () => barOf('half-time, 88 BPM', 88, [0, 10], [8]),
    () => barOfPattern('pulse'),
    () => barOfPattern('drift'),
    () => barOfPattern('shatter'),
    preDropBreath,
    () => steadyBreath('four on the floor', 124, [0, 4, 8, 12]),
    () => steadyBreath('sparse trap', 140, [0, 11]),
    () => steadyBreath('syncopated R&B', 76, [0, 3, 7, 10]),
    () => vibeOfPattern('pulse'),
    () => vibeOfPattern('drift'),
    () => vibeOfPattern('shatter'),
    () => vibeOfPattern('still'),
    () => tempoOf('pulse'),
    () => tempoOf('drift'),
    () => tempoOf('shatter'),
    () => tempoOf('still'),
    freeTimePiano,
    subAndWhisper,
    denseMetal,
    brightness,
  ]) {
    rows.push(await test());
  }
  rows.push(...(await songScore()));
  rows.push(...(await voiceParts()));
  return rows;
}
