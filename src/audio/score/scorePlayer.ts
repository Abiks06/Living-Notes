import { type AudioFeatures, LINE_AHEAD_S, LINE_PAST_S, LINE_ROWS } from '../features';
import { type Hit, SCORE_RATE, type Score } from './score';
import { titleMoment } from './titleMoment';
import { CHROMA_RATE } from './voices';

/**
 * Anticipation. Particles need about a third of a second to swell, so motion starts that much
 * before the hit, in order to peak on it. Measured on Sphere Pulse, the swell otherwise peaks
 * over 350 ms after the kick. Only a song known in advance can do this.
 */
export const MOTION_LEAD_S = 0.22;
/** Light appears at once, so it barely leads. People forgive early far more readily than late. */
export const LIGHT_LEAD_S = 0.03;
const HIT_DECAY_S: Record<Hit, number> = { kick: 0.22, snare: 0.18, hat: 0.09 };
const IMPACT_S = 0.55;
/** How long the picture hangs before a drop. Long enough to feel, short enough not to stutter. */
const HANG_S = 0.22;
const CONTRAST = 1.6;
/** How many beats before a drop the breath starts to draw in. */
const BREATH_BEATS = 2;
const MIN_TEMPO_CONFIDENCE = 0.2;
const MIN_MELODY_RANGE = 12;
const LINE_GLIDE = 0.3;
const NOTE_DECAY_S = 0.28;
/** A narrow riff still spreads out, but a single note doesn't climb the whole neck. */
const MIN_NOTE_RANGE = 12;

/** The latest entry at or before `time`, by binary search; -1 if there is none. */
function lastAtOrBefore(list: Float32Array, time: number): number {
  let low = 0;
  let high = list.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((list[mid] ?? 0) <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

const sample = (list: Float32Array, time: number) => list[Math.floor(time * SCORE_RATE)] ?? 0;

/**
 * Plays a score against the transport, replacing what live analysis can only hear late. Every
 * hit is known in advance, so nothing here waits for a sound to arrive.
 */
export class ScorePlayer {
  private time = -1;
  private loops = 0;
  private snares = 0;
  private hats = 0;
  private onsets = 0;
  private notes = 0;
  private chords = 0;
  private titled: Score | null = null;
  private titleAt = 0;

  /** @param heard Song position reaching the listener now, in seconds. */
  apply(score: Score, heard: number, out: AudioFeatures): void {
    const limit = (time: number) => Math.min(Math.max(0, time), score.duration - 1e-3);
    const t = limit(heard + LIGHT_LEAD_S);
    const ahead = limit(heard + MOTION_LEAD_S);
    // Backward means the track looped or was seeked: counts carry on, only the song restarts.
    if (t < this.time - 0.25) this.loops++;
    this.count(score, t);
    this.writeVoices(score, t, out);
    this.writeLine(score, t, out);
    this.time = t;

    this.writeHits(score, t, ahead, out);
    this.writeLevels(score, ahead, out);
    this.writeBeat(score, ahead, out);
    this.writeForm(score, t, out);
    // Worked out here rather than in the score, so songs already analysed get it too.
    if (this.titled !== score) {
      this.titled = score;
      this.titleAt = titleMoment(score);
    }
    out.titleDue = t >= this.titleAt;
    out.scored = true;
  }

  reset(): void {
    this.time = -1;
    this.loops = 0;
  }

  /** Hits crossed since the last frame, for everything that reacts to a count changing. */
  private count(score: Score, t: number): void {
    const from = this.time;
    const crossed = (list: Float32Array) =>
      t >= from ? lastAtOrBefore(list, t) - lastAtOrBefore(list, from) : 0;
    this.snares += crossed(score.hits.snare);
    this.hats += crossed(score.hits.hat);
    this.onsets += crossed(score.hits.kick) + crossed(score.hits.snare);
  }

  /** The stretch of melody either side of now, for drawing. */
  private writeLine(score: Score, t: number, out: AudioFeatures): void {
    const range = Math.max(MIN_MELODY_RANGE, score.melodyHigh - score.melodyLow);
    const spare = (range - (score.melodyHigh - score.melodyLow)) / 2;
    const place = (note: number) =>
      Math.min(1, Math.max(0, (note - score.melodyLow + spare) / range));
    const span = LINE_PAST_S + LINE_AHEAD_S;
    let height = out.melody;
    for (let row = 0; row < LINE_ROWS; row++) {
      const time = t - LINE_PAST_S + (row / (LINE_ROWS - 1)) * span;
      const note = time >= 0 ? sample(score.melody, time) : 0;
      // A gap holds the last height, so the line never dives to the floor between phrases, and
      // it glides from note to note the way a voice does.
      if (note > 0) height += (place(note) - height) * LINE_GLIDE;
      out.line[row * 2] = height;
      out.line[row * 2 + 1] = note > 0 ? sample(score.melodyLevel, time) : 0;
    }
    const now = sample(score.melody, t);
    if (now > 0) out.melody = place(now);
  }

  /** Everything but the drums. Pitched sound is read as it's heard: it's seen at once. */
  private writeVoices(score: Score, t: number, out: AudioFeatures): void {
    out.sustain = sample(score.sustain, t);
    out.noteLevel = sample(score.notes, t);
    out.grit = sample(score.grit, t);

    const from = this.time;
    const crossed = (list: Float32Array) =>
      t >= from ? lastAtOrBefore(list, t) - lastAtOrBefore(list, from) : 0;
    this.notes += crossed(score.noteTimes);
    this.chords += crossed(score.chordTimes);
    out.noteCount = this.notes;

    const note = lastAtOrBefore(score.noteTimes, t);
    out.noteHit = 0;
    if (note >= 0) {
      const age = t - (score.noteTimes[note] ?? 0);
      out.noteHit = (score.noteStrengths[note] ?? 0) * Math.max(0, 1 - age / NOTE_DECAY_S);
      const range = Math.max(MIN_NOTE_RANGE, score.noteHigh - score.noteLow);
      const pitch = ((score.notePitches[note] ?? score.noteLow) - score.noteLow) / range;
      out.notePitch = Math.min(1, Math.max(0, pitch));
    }

    // Harmony known in advance has none of the live version's lag.
    const step = Math.floor(t * CHROMA_RATE) * 12;
    if (step + 12 > score.chroma.length) return;
    let top = 0;
    let strongest = 0;
    for (let pitch = 0; pitch < 12; pitch++) {
      const level = score.chroma[step + pitch] ?? 0;
      out.chroma[pitch] = level;
      if (level > top) {
        top = level;
        strongest = pitch;
      }
    }
    out.pitchClass = strongest;
    out.pitchConfidence = Math.max(out.sustain, out.noteLevel);
    out.harmonyCount = this.chords;
  }

  private writeHits(score: Score, t: number, ahead: number, out: AudioFeatures): void {
    const pulse = (hit: Hit, at = t) => {
      const list = score.hits[hit];
      const index = lastAtOrBefore(list, at);
      if (index < 0) return 0;
      return Math.max(0, 1 - (at - (list[index] ?? 0)) / HIT_DECAY_S[hit]);
    };
    out.kick = pulse('kick');
    out.push = pulse('kick', ahead);
    out.snare = pulse('snare');
    out.hat = pulse('hat');
    out.beat = Math.max(out.kick, out.snare);
    out.snareCount = this.snares;
    out.hatCount = this.hats;
    out.beatCount = this.onsets;
  }

  private writeLevels(score: Score, t: number, out: AudioFeatures): void {
    const { env } = score;
    // The same contrast live analysis applies: only real hits should reach the top of the range.
    const level = (list: Float32Array) => sample(list, t) ** CONTRAST;
    const bass = level(env.bass);
    const kick = level(env.kick);
    out.gate = 1;
    out.bands[0] = bass;
    out.bands[1] = Math.max(bass * 0.7, kick);
    // Every band has to come from the score: a mix of early and late moves cancels itself out.
    const snare = level(env.snare);
    const lead = level(env.lead);
    out.bands[2] = Math.max(bass * 0.5, lead * 0.6);
    out.bands[3] = Math.max(lead, snare * 0.8);
    out.bands[4] = Math.max(snare, lead * 0.5);
    out.bands[5] = level(env.hat);
    out.energy = Math.min(1, bass * 0.5 + kick * 0.75);
    // A filtered band isn't a singer. True stems can say so, and so can a stereo mix's centre.
    if (score.trueStems) out.vocal = sample(env.lead, t);
    else if (score.hasVoice) out.vocal = sample(score.voice, t);
  }

  private writeBeat(score: Score, t: number, out: AudioFeatures): void {
    if (score.bpm <= 0 || score.tempoConfidence < MIN_TEMPO_CONFIDENCE) return;
    const beat = 60 / score.bpm;
    const played = lastAtOrBefore(score.beats, t);
    const start = score.beats[played] ?? 0;
    const next = score.beats[played + 1] ?? start + beat;
    const position =
      played >= 0 ? played + (t - start) / (next - start) : (t - score.beatOffset) / beat;
    const whole = Math.floor(position);
    const perSong = Math.ceil(score.duration / beat);
    const index = Math.max(0, whole) + this.loops * perSong;
    const phase = position - whole;
    const inBar = (((whole - score.downbeat) % 4) + 4) % 4;

    out.bpm = score.bpm;
    out.tempoConfidence = Math.max(score.tempoConfidence, 0.6);
    out.beatPhase = phase;
    out.beatIndex = index;
    out.barBeat = inBar;
    // Bars were counted on the steady grid, which a played beat has left behind.
    out.barConfidence = played >= 0 ? 0 : score.barConfidence;
    out.grooveScale = score.grooveScale;
    out.groovePhase = score.grooveScale < 1 ? ((inBar % 2) + phase) / 2 : phase;
    out.feltBeat = score.grooveScale < 1 ? Math.floor(index / 2) : index;
  }

  /**
   * The song's shape, read on the sound rather than ahead of it. A drop is the one thing that
   * must not arrive early: its light is instant, and anything sooner gives it away.
   */
  private writeForm(score: Score, t: number, out: AudioFeatures): void {
    out.presence = sample(score.presence, t);
    out.intensity = out.presence;
    out.tension = sample(score.tension, t);
    out.world = sample(score.world, t);
    out.sectionPart = score.sectionParts[lastAtOrBefore(score.sectionStarts, t)] ?? -1;
    // Filtered bands can miss a drop. Live detection then keeps listening for one.
    if (score.drops.length === 0) return;
    const beat = score.bpm > 0 ? 60 / score.bpm : 0.5;
    const window = beat * BREATH_BEATS;
    const hang = Math.min(HANG_S, beat / 2);
    out.inhale = 0;
    out.impact = 0;
    for (let i = 0; i < score.drops.length; i++) {
      const drop = score.drops[i] ?? 0;
      if (t >= drop - window && t < drop) {
        const x = (t - (drop - window)) / window;
        out.inhale = x * x * (3 - 2 * x);
        if (t >= drop - hang) out.hang = score.hangs[i] ?? 0;
      } else if (t >= drop && t < drop + IMPACT_S) {
        out.impact = 1 - (t - drop) / IMPACT_S;
        out.dropPower = score.dropPower[i] ?? 1;
      }
    }
  }
}
