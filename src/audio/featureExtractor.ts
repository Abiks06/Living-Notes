import { BAND_COUNT, type BandLayout, createBandLayout, NO_BAND } from './bands';
import { BeatDetector } from './beatDetector';
import { DynamicsTracker } from './dynamics';
import { clamp01, follow } from './envelope';
import { type AudioFeatures, BIN_COUNT, FFT_SIZE, PITCH_FFT_SIZE } from './features';
import { LiveForm } from './liveForm';
import { HIGH_NOTE, LiveMelody, LOW_NOTE } from './liveMelody';
import { MoodTracker } from './mood';
import { BarTracker, InhaleTracker } from './phrasing';
import { TEMPO_LOCKED, TempoTracker } from './tempo';
import { ChromaTracker, SpectralShape } from './tone';

const ATTACK_S = 0.012;
/** Low bands ring longer; highs release quickly so sparkle stays crisp. */
const RELEASE_S = [0.18, 0.15, 0.12, 0.1, 0.08, 0.07];
const PEAK_RELEASE_S = 6;
const FLOOR_RISE_S = 2.5;
const MIN_RANGE = 0.08;
/** >1 pushes mid-level energy down so only real hits reach the top of the range. */
const CONTRAST = 1.6;
const LEVEL_WEIGHTS = [0.22, 0.24, 0.16, 0.16, 0.12, 0.1];
/** Pitch confidence rarely nears 1 on a full mix, so this restores the range. */
const MELODY_LOW = 55;
const MELODY_RANGE = 36;
const VOCAL_GAIN = 1.5;
const LEAD_GAIN = 1.3;
/** Below this the line is too faint to say where it is. */
const LEAD_HEARD = 0.12;
const LEAD_NOTE = 0.35;
/** As fast as a quick run of notes, and no faster, or a wobble in pitch would rattle. */
const MIN_STEP_S = 0.15;
const VOCAL_ATTACK_S = 0.06;
const VOCAL_RELEASE_S = 0.4;
const HELD_GAIN = 1.8;
const HELD_ATTACK_S = 0.5;
const HELD_RELEASE_S = 1.2;
const NOTE_DECAY_S = 0.28;
const LOW_STRING = 40;
const STRING_RANGE = 48;
/** A quiet section keeps this much of its movement; the rest is earned by loudness. */
const QUIET_SCALE = 0.35;
/**
 * The pulse the tempo tracker listens to. Off-grid kicks mislead it: gaps of five 16ths read
 * as 112 BPM in a 140 BPM trap groove. The backbeat and hats hold the grid in hip-hop and
 * R&B, and kick flux runs far larger than theirs, so it's turned well down.
 */
const PULSE_KICK = 0.3;
const PULSE_SNARE = 1.35;
const PULSE_HAT = 1;

/**
 * Turns the analysers' output into `AudioFeatures`, in two layers.
 *
 * Micro: each band carries its own automatic gain, a slow-decaying peak and a slow-rising
 * floor, so every band moves across its full range on a dull old recording and a bright
 * modern master alike. Left alone that erases the song's shape, because it rescales any
 * section to full height within seconds.
 *
 * Macro: `DynamicsTracker` then restores the shape. The gate silences anything that isn't
 * signal, and section loudness scales the result, so a breakdown is small and a drop is big.
 */
export class FeatureExtractor {
  private readonly layout: BandLayout;
  private readonly beats: BeatDetector;
  private readonly dynamics = new DynamicsTracker();
  private readonly shape: SpectralShape;
  private readonly chroma: ChromaTracker;
  private readonly lead: LiveMelody;
  private readonly tempo = new TempoTracker();
  private readonly bars = new BarTracker();
  private readonly breath = new InhaleTracker();
  private readonly form = new LiveForm();
  /** Each band before auto-gain, on the analyser's decibel scale. */
  readonly levels = new Float32Array(BAND_COUNT);
  private readonly mood = new MoodTracker();
  private melodyNote = MELODY_LOW + MELODY_RANGE / 2;
  private notes = 0;
  private stepped = false;
  private sinceStep = 0;
  private lastKicks = 0;
  private lastSnares = 0;
  private lastOnsets = 0;
  private readonly sums = new Float32Array(BAND_COUNT);
  private readonly peaks = new Float32Array(BAND_COUNT).fill(MIN_RANGE);
  private readonly floors = new Float32Array(BAND_COUNT);
  /** The latest stretch of sound, as the analyser heard it. */
  readonly samples = new Float32Array(FFT_SIZE);
  private readonly pitchSpectrum = new Uint8Array(PITCH_FFT_SIZE / 2);

  /**
   * @param sensitivity Per-band multipliers owned by the engine (the Studio sliders);
   *   read live every frame, so changes apply without rebuilding anything.
   */
  constructor(
    sampleRate: number,
    private readonly sensitivity: Float32Array,
  ) {
    this.layout = createBandLayout(sampleRate, FFT_SIZE);
    this.beats = new BeatDetector(this.layout, BIN_COUNT);
    this.shape = new SpectralShape(sampleRate, FFT_SIZE);
    this.chroma = new ChromaTracker(sampleRate, PITCH_FFT_SIZE);
    this.lead = new LiveMelody(sampleRate, PITCH_FFT_SIZE);
  }

  update(
    analyser: AnalyserNode,
    pitchAnalyser: AnalyserNode,
    dt: number,
    out: AudioFeatures,
  ): void {
    const spectrum = out.spectrum;
    analyser.getByteFrequencyData(spectrum);
    analyser.getFloatTimeDomainData(this.samples);
    pitchAnalyser.getByteFrequencyData(this.pitchSpectrum);

    let power = 0;
    for (let i = 0; i < this.samples.length; i++) power += (this.samples[i] ?? 0) ** 2;
    this.dynamics.update(Math.sqrt(power / this.samples.length), dt);
    const { gate, intensity } = this.dynamics;
    const scale = gate * (QUIET_SCALE + (1 - QUIET_SCALE) * intensity ** 1.2);

    const { binToBand, binCounts } = this.layout;
    const sums = this.sums;
    sums.fill(0);
    for (let bin = 0; bin < spectrum.length; bin++) {
      const band = binToBand[bin] ?? NO_BAND;
      if (band !== NO_BAND) sums[band] = (sums[band] ?? 0) + (spectrum[bin] ?? 0);
    }

    // While gated, auto-gain holds still: it must not learn the shape of room noise.
    const adapting = gate > 0.1;
    const peakDecay = Math.exp(-dt / PEAK_RELEASE_S);
    const floorRise = 1 - Math.exp(-dt / FLOOR_RISE_S);
    let level = 0;

    for (let band = 0; band < BAND_COUNT; band++) {
      const raw = (sums[band] ?? 0) / (Math.max(1, binCounts[band] ?? 1) * 255);
      this.levels[band] = raw;

      let peak = this.peaks[band] ?? MIN_RANGE;
      let floor = this.floors[band] ?? 0;
      if (adapting) {
        peak = raw > peak ? raw : peak * peakDecay + raw * (1 - peakDecay);
        this.peaks[band] = peak;
        floor = raw < floor ? raw : floor + (raw - floor) * floorRise;
        this.floors[band] = floor;
      }

      const range = Math.max(MIN_RANGE, peak - floor);
      const shaped = clamp01((raw - floor) / range) ** CONTRAST;
      const normalized = clamp01(shaped * (this.sensitivity[band] ?? 1) * scale);
      out.rawBands[band] = normalized;
      out.bands[band] = follow(
        out.bands[band] ?? 0,
        normalized,
        dt,
        ATTACK_S,
        RELEASE_S[band] ?? 0.2,
      );
      level += (out.bands[band] ?? 0) * (LEVEL_WEIGHTS[band] ?? 0);
    }
    out.level = level;

    const active = gate > 0.3;
    this.beats.update(spectrum, dt, active);
    this.shape.update(spectrum, dt, active);
    this.chroma.update(this.pitchSpectrum, dt, active);
    this.lead.update(this.pitchSpectrum, dt, active);
    const { all, kick, snare, hat } = this.beats;
    const pulse = PULSE_KICK * kick.flux + PULSE_SNARE * snare.flux + PULSE_HAT * hat.flux;
    this.tempo.update(active ? pulse : 0, dt);

    out.beat = all.pulse;
    out.beatStrength = all.strength;
    out.beatCount = all.count;
    out.flux = all.flux;
    out.kick = kick.pulse;
    out.push = kick.pulse;
    out.snare = snare.pulse;
    out.snareCount = snare.count;
    out.hat = hat.pulse;
    out.hatCount = hat.count;

    out.gate = gate;
    out.intensity = intensity;
    out.loudnessDb = this.dynamics.loudnessDb;
    out.centroid = this.shape.centroid;
    out.flatness = this.shape.flatness;
    out.chroma.set(this.chroma.chroma);
    out.pitchClass = this.chroma.pitchClass;
    out.pitchConfidence = this.chroma.confidence;
    out.harmonyCount = this.chroma.changeCount;
    const melodic = (out.bands[3] ?? 0) * 0.6 + (out.bands[4] ?? 0) * 0.4;
    const presence = melodic * (1 - this.shape.flatness) * this.chroma.confidence * VOCAL_GAIN;
    // A line that stands clear of the mix counts too: chroma alone reads most full mixes as
    // having almost no voice, which left the melody line and the voice's light nearly still.
    const line = this.lead.level * melodic * LEAD_GAIN;
    out.vocal = follow(
      out.vocal,
      clamp01(Math.max(presence, line)),
      dt,
      VOCAL_ATTACK_S,
      VOCAL_RELEASE_S,
    );
    const before = Math.round(this.melodyNote);
    if (this.lead.level >= LEAD_HEARD) {
      this.melodyNote += (this.lead.note - this.melodyNote) * (1 - Math.exp(-dt / 0.04));
    }
    this.sinceStep += dt;
    this.stepped =
      Math.round(this.melodyNote) !== before &&
      this.lead.level >= LEAD_NOTE &&
      this.sinceStep >= MIN_STEP_S;
    if (this.stepped) this.sinceStep = 0;
    // Across the whole range the live line can report, so low notes aren't flattened.
    out.melody = clamp01((this.melodyNote - LOW_NOTE) / (HIGH_NOTE - LOW_NOTE));
    out.bpm = this.tempo.bpm;
    out.beatPhase = this.tempo.phase;
    out.tempoConfidence = this.tempo.confidence;
    out.beatIndex = this.tempo.beatIndex;

    const kickHit = kick.count !== this.lastKicks;
    const snareHit = snare.count !== this.lastSnares;
    const onset = all.count !== this.lastOnsets;
    this.writeVoices(out, dt, snareHit);
    this.lastKicks = kick.count;
    this.lastSnares = snare.count;
    this.lastOnsets = all.count;
    const locked = this.tempo.confidence >= TEMPO_LOCKED;
    this.bars.update(out.beatIndex, out.beatPhase, out.bpm, locked, kickHit, snareHit);
    out.barBeat = this.bars.barBeat;
    out.barConfidence = this.bars.confidence;
    out.grooveScale = this.bars.grooveScale;
    out.groovePhase = this.bars.groovePhase;
    out.feltBeat = this.bars.feltBeat;
    this.breath.update(dt, kickHit, gate);
    out.inhale = this.breath.inhale;
    this.form.update(this.levels, kickHit, gate, dt);
    out.impact = this.form.impact;
    out.dropPower = this.form.dropPower;
    out.presence = this.form.presence;
    out.tension = this.form.tension;
    out.world = this.form.world;
    this.mood.update(dt, {
      gate,
      intensity,
      centroid: this.shape.centroid,
      vocal: out.vocal,
      bpm: out.bpm,
      locked,
      onset,
    });
    out.arousal = this.mood.arousal;
    out.brightness = this.mood.brightness;
    out.vibe = this.mood.vibe;

    const low = (out.bands[0] ?? 0) * 0.5 + (out.bands[1] ?? 0) * 0.75;
    const tonal = 1 - this.shape.flatness;
    out.energy = clamp01(Math.max(low, low + (level * 1.6 - low) * tonal));
    out.live = true;
  }

  /** @param live True for inputs with a noise floor of their own (mic, tab audio). */
  /**
   * A rough live stand-in for what a score reads from the whole song: live analysis can't
   * separate anything, but pitched mid-range hits are mostly notes, and steady pitch mostly held.
   */
  private writeVoices(out: AudioFeatures, dt: number, midHit: boolean): void {
    const tonal = (1 - out.flatness) * out.pitchConfidence;
    const mids = ((out.bands[2] ?? 0) + (out.bands[3] ?? 0)) / 2;
    const held = clamp01(mids * tonal * HELD_GAIN);
    out.sustain = follow(out.sustain, held, dt, HELD_ATTACK_S, HELD_RELEASE_S);
    out.noteHit = Math.max(0, out.noteHit - dt / NOTE_DECAY_S);
    // A tune moving to a new note is a note too, hit or no hit: sung lines and legato leads
    // have no attack to catch, and without this the strings sat still through them.
    if (this.stepped || (midHit && out.pitchConfidence >= 0.25 && out.flatness < 0.5)) {
      this.notes++;
      out.noteHit = 1;
    }
    out.noteCount = this.notes;
    out.noteLevel = out.noteHit;
    const pitch = (this.melodyNote - LOW_STRING) / STRING_RANGE;
    out.notePitch = clamp01(pitch);
    out.grit = out.flatness;
  }

  reset(live: boolean): void {
    this.beats.reset();
    this.dynamics.reset(live);
    this.chroma.reset();
    this.lead.reset();
    this.tempo.reset();
    this.bars.reset();
    this.breath.reset();
    this.form.reset();
    this.mood.reset();
    this.peaks.fill(MIN_RANGE);
    this.floors.fill(0);
  }
}
