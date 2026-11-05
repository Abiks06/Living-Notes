import type { Lane } from '../score/score';
import {
  bass,
  clap,
  createNoise,
  hat,
  kick,
  midiToHz,
  pad,
  type Rig,
  snare,
  sub,
} from './instruments';

const SAMPLE_RATE = 44100;
const BPM = 100;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

/** A minor → F → C → G. */
const CHORDS = [
  { root: 45, notes: [57, 60, 64, 69] },
  { root: 41, notes: [53, 57, 60, 65] },
  { root: 48, notes: [55, 60, 64, 67] },
  { root: 43, notes: [55, 59, 62, 67] },
] as const;

/** [beat, MIDI note, beats held] across four bars. */
const VERSE_LINE: readonly (readonly [number, number, number])[] = [
  [0, 69, 1.5],
  [1.5, 72, 0.5],
  [2, 71, 1],
  [3, 69, 1],
  [4, 65, 2],
  [6, 69, 1],
  [7, 72, 1],
  [8, 76, 2],
  [10, 74, 1],
  [11, 72, 1],
  [12, 71, 2.5],
  [14.5, 67, 1.5],
];

const HOOK_LINE: readonly (readonly [number, number, number])[] = [
  [0, 76, 1],
  [1, 81, 1.5],
  [2.5, 79, 0.5],
  [3, 76, 1],
  [4, 77, 1],
  [5, 81, 1],
  [6, 84, 2],
  [8, 79, 1],
  [9, 84, 1.5],
  [10.5, 83, 0.5],
  [11, 79, 1],
  [12, 79, 1],
  [13, 83, 1],
  [14, 86, 2],
];

type Section = 'intro' | 'verse' | 'build' | 'drop' | 'break' | 'outro';

const FORM: readonly { section: Section; bars: number }[] = [
  { section: 'intro', bars: 4 },
  { section: 'verse', bars: 8 },
  { section: 'build', bars: 4 },
  { section: 'drop', bars: 8 },
  { section: 'break', bars: 4 },
  { section: 'build', bars: 4 },
  { section: 'drop', bars: 8 },
  { section: 'outro', bars: 2 },
];

/** A sung-sounding line: a soft reed through a vocal formant, with a little vibrato. */
function voice(rig: Rig, t: number, note: number, length: number, peak: number): void {
  const { ctx } = rig;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = midiToHz(note);
  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 5.2;
  const depth = ctx.createGain();
  depth.gain.value = midiToHz(note) * 0.008;
  vibrato.connect(depth).connect(osc.frequency);

  const formant = ctx.createBiquadFilter();
  formant.type = 'lowpass';
  formant.frequency.value = 1900;
  formant.Q.value = 2;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + 0.05);
  env.gain.setValueAtTime(peak, t + Math.max(0.06, length - 0.1));
  env.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(formant).connect(env).connect(rig.out);
  osc.start(t);
  vibrato.start(t);
  osc.stop(t + length + 0.02);
  vibrato.stop(t + length + 0.02);
}

type Part = Lane | 'pad';
const PARTS: readonly Part[] = ['kick', 'snare', 'hat', 'bass', 'lead', 'pad'];
/** Longest ring-out past the end of a bar. */
const TAIL_S = 1.8;

interface Note {
  bar: number;
  at: number;
  note: number;
  held: number;
  peak: number;
}

/** Every sung note, filed under the bar it starts in. */
function melodyNotes(): Note[] {
  const notes: Note[] = [];
  let start = 0;
  for (const { section, bars } of FORM) {
    const line = section === 'drop' ? HOOK_LINE : VERSE_LINE;
    const sings = section === 'verse' || section === 'drop' || section === 'break';
    for (let group = 0; sings && group < bars; group += 4) {
      for (const [beat, note, held] of line) {
        const time = (start + group) * BAR + beat * BEAT;
        // The small nudge keeps a note on a bar line from rounding into the bar before.
        const bar = Math.floor(time / BAR + 1e-6);
        notes.push({
          bar,
          at: Math.max(0, time - bar * BAR),
          note,
          held: held * BEAT,
          peak: section === 'drop' ? 0.2 : 0.17,
        });
      }
    }
    start += bars;
  }
  return notes;
}

/** Plays one bar of one part, starting at time 0. */
function performBar(rig: Rig, part: Part, section: Section, bar: number, last: boolean): void {
  const chord = CHORDS[bar % CHORDS.length] ?? CHORDS[0];
  const drums = section === 'verse' || section === 'build' || section === 'drop';

  if (part === 'pad') pad(rig, 0, chord.notes, BAR, section === 'drop' ? 0.07 : 0.055);

  if (part === 'bass') {
    if (section === 'drop') {
      for (const beat of [0, 1, 2, 3]) bass(rig, beat * BEAT, chord.root + 12, BEAT * 0.8, 0.3);
      sub(rig, 0, chord.root, BAR * 0.95, 0.42);
    } else if (section === 'verse' || section === 'build') {
      sub(rig, 0, chord.root, BAR * 0.9, 0.3);
    }
  }

  // The last two beats before a drop lose their kick: that gap is what a drop is built on.
  const gap = section === 'build' && last;
  if (drums && part === 'kick') {
    const beats = section === 'drop' ? [0, 1, 2, 3] : [0, 2.5];
    for (const beat of beats) if (!gap || beat < 2) kick(rig, beat * BEAT, 0.95);
  }
  if (drums && part === 'snare') {
    for (const beat of [1, 3]) {
      if (section === 'drop') clap(rig, beat * BEAT, 0.5);
      else snare(rig, beat * BEAT, 0.45);
    }
    if (gap) for (let i = 0; i < 8; i++) snare(rig, (2 + i / 4) * BEAT, 0.12 + i * 0.04);
  }
  if (drums && part === 'hat') {
    const step = section === 'verse' ? 0.5 : 0.25;
    for (let beat = 0; beat < 4; beat += step) {
      hat(rig, beat * BEAT, beat % 1 === 0 ? 0.12 : 0.08);
    }
  }
  if (part === 'lead') {
    for (const note of melodyNotes()) {
      if (note.bar === bar) voice(rig, note.at, note.note, note.held, note.peak);
    }
  }
}

/**
 * Renders one part, a bar at a time. An offline render visits every scheduled node on every
 * block, so one graph holding a whole song takes far longer than the song. Small ones add up
 * in a fraction of that, and the waits between them keep the page responsive.
 */
async function renderPart(part: Part, noise: AudioBuffer, length: number): Promise<Float32Array> {
  const out = new Float32Array(length);
  let bar = 0;
  for (const { section, bars } of FORM) {
    for (let b = 0; b < bars; b++, bar++) {
      const ctx = new OfflineAudioContext(1, Math.ceil((BAR + TAIL_S) * SAMPLE_RATE), SAMPLE_RATE);
      performBar({ ctx, out: ctx.destination, noise }, part, section, bar, b === bars - 1);
      const rendered = (await ctx.startRendering()).getChannelData(0);
      const start = Math.round(bar * BAR * SAMPLE_RATE);
      const count = Math.min(rendered.length, length - start);
      for (let i = 0; i < count; i++) out[start + i] = (out[start + i] ?? 0) + (rendered[i] ?? 0);
    }
  }
  return out;
}

function toBuffer(samples: Float32Array): AudioBuffer {
  const buffer = new AudioBuffer({
    length: samples.length,
    numberOfChannels: 1,
    sampleRate: SAMPLE_RATE,
  });
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  return buffer;
}

export interface ProofSong {
  mix: AudioBuffer;
  stems: Record<Lane, AudioBuffer>;
}

let song: Promise<ProofSong> | null = null;

/**
 * A complete song with verses, builds and drops. The mix is literally the sum of its stems,
 * so real stems can test the idea of one actor per instrument with perfect separation, before
 * any machine learning is involved.
 */
export function renderProofSong(): Promise<ProofSong> {
  song ??= (async () => {
    const bars = FORM.reduce((sum, part) => sum + part.bars, 0);
    const length = Math.ceil(bars * BAR * SAMPLE_RATE);
    const noise = createNoise(new OfflineAudioContext(1, 1, SAMPLE_RATE), 2);
    const parts = await Promise.all(PARTS.map((part) => renderPart(part, noise, length)));

    const mix = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      let sum = 0;
      for (const part of parts) sum += part[i] ?? 0;
      // A soft ceiling in place of a compressor: the loud parts round off rather than clip.
      mix[i] = Math.tanh(sum * 0.75);
    }
    const [kickLane, snareLane, hatLane, bassLane, leadLane] = parts.map(toBuffer);
    if (!kickLane || !snareLane || !hatLane || !bassLane || !leadLane) {
      throw new Error('The song failed to render.');
    }
    return {
      mix: toBuffer(mix),
      stems: {
        kick: kickLane,
        snare: snareLane,
        hat: hatLane,
        bass: bassLane,
        lead: leadLane,
      },
    };
  })();
  // Keep a success, but never a failure: the next try should really try again.
  song.catch(() => {
    song = null;
  });
  return song;
}
