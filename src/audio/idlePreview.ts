import { BAND, BAND_COUNT } from './bands';
import { follow } from './envelope';
import { type AudioFeatures, BIN_COUNT, SPECTRUM_MAX_BIN } from './features';

const BPM = 124;
const BEAT_S = 60 / BPM;
const targets = new Float32Array(BAND_COUNT);

/**
 * Drives `AudioFeatures` with a tempo-locked synthetic groove while nothing is
 * audible (before the first click, or between sources), so the scene is never still.
 */
export class IdlePreview {
  private time = 0;
  private lastBeatIndex = -1;
  private beatCount = 0;

  update(dt: number, out: AudioFeatures): void {
    this.time += dt;
    const t = this.time;
    const beatIndex = Math.floor(t / BEAT_S);
    const phase = (t % BEAT_S) / BEAT_S;
    const eighth = ((t * 2) % BEAT_S) / BEAT_S;

    if (beatIndex !== this.lastBeatIndex) {
      this.lastBeatIndex = beatIndex;
      this.beatCount++;
      out.beat = beatIndex % 4 === 0 ? 1 : 0.75;
      out.beatStrength = beatIndex % 4 === 0 ? 1 : 0.45;
      out.kick = 1;
      if (beatIndex % 2 === 1) {
        out.snare = 0.9;
        out.snareCount++;
      }
      if (beatIndex % 8 === 0) {
        out.pitchClass = (out.pitchClass + 7) % 12;
        out.harmonyCount++;
      }
    } else {
      out.beat = Math.max(0, out.beat - dt / 0.2);
      out.kick = Math.max(0, out.kick - dt / 0.22);
      out.snare = Math.max(0, out.snare - dt / 0.18);
    }
    if (Math.floor((t * 4) / BEAT_S) !== Math.floor(((t - dt) * 4) / BEAT_S)) {
      out.hat = 0.8;
      out.hatCount++;
    } else {
      out.hat = Math.max(0, out.hat - dt / 0.09);
    }

    const kick = Math.exp(-phase * 7);
    targets[BAND.subBass] = 0.85 * kick;
    targets[BAND.bass] = 0.75 * kick + 0.15;
    targets[BAND.lowMid] = 0.35 + 0.2 * Math.sin(t * 0.9);
    targets[BAND.mid] = 0.4 + 0.25 * Math.sin(t * 0.55 + 1.3);
    targets[BAND.highMid] = 0.3 + 0.3 * Math.exp(-eighth * 9);
    targets[BAND.treble] = 0.25 + 0.45 * Math.exp(-eighth * 12);

    let level = 0;
    for (let band = 0; band < BAND_COUNT; band++) {
      const target = targets[band] ?? 0;
      out.rawBands[band] = target;
      out.bands[band] = follow(out.bands[band] ?? 0, target, dt, 0.012, 0.18);
      level += (out.bands[band] ?? 0) / BAND_COUNT;
    }
    out.level = level;
    out.energy = level * 1.3;
    out.gate = 1;
    out.intensity = 0.85;
    out.centroid = 0.45 + 0.15 * Math.sin(t * 0.3);
    out.flatness = 0.4;
    out.pitchConfidence = 0.6;
    out.vocal = 0;
    out.scored = false;
    out.titleDue = false;
    out.presence = 1;
    out.bpm = BPM;
    out.beatPhase = phase;
    out.tempoConfidence = 1;
    out.beatIndex = beatIndex;
    out.barBeat = beatIndex % 4;
    out.barConfidence = 0;
    out.grooveScale = 1;
    out.groovePhase = phase;
    out.feltBeat = beatIndex;
    out.inhale = 0;
    out.impact = 0;
    out.dropPower = 1;
    out.tension = 0;
    out.hang = 0;
    out.world = 0;
    out.sectionPart = -1;
    out.handoff = 0;
    out.sustain = 0;
    out.noteLevel = 0;
    out.noteHit = 0;
    out.grit = 0;
    out.arousal = 0;
    out.brightness = 0.5;
    out.vibe = 0;
    out.beatCount = this.beatCount;
    out.flux = out.beat * 0.05;
    out.live = false;
    this.writeSpectrum(out);
  }

  /**
   * A plausible-looking spectrum (downward tilt + band energies) for the spectrum strip.
   * Only bins the strip draws are written; the two ripples advance by angle addition,
   * so the loop has no transcendental calls.
   */
  private writeSpectrum(out: AudioFeatures): void {
    const spectrum = out.spectrum;
    // Coming from live audio, clear the undrawn tail once so it doesn't hold stale data.
    if (out.live) spectrum.fill(0, SPECTRUM_MAX_BIN);
    spectrum[0] = 0;

    const t = this.time;
    let s1 = Math.sin(RIPPLE_1 + t * 3.1);
    let c1 = Math.cos(RIPPLE_1 + t * 3.1);
    let s2 = Math.sin(RIPPLE_2 - t * 1.7);
    let c2 = Math.cos(RIPPLE_2 - t * 1.7);

    for (let bin = 1; bin < SPECTRUM_MAX_BIN; bin++) {
      const energy = out.bands[BIN_BAND[bin] ?? 0] ?? 0;
      const value = (0.35 + 0.6 * energy) * (BIN_TILT[bin] ?? 1) + 0.08 * s1 + 0.05 * s2;
      spectrum[bin] = Math.max(0, Math.min(255, value * 230)); // Uint8Array wraps, not clamps

      const n1 = s1 * COS_1 + c1 * SIN_1;
      c1 = c1 * COS_1 - s1 * SIN_1;
      s1 = n1;
      const n2 = s2 * COS_2 + c2 * SIN_2;
      c2 = c2 * COS_2 - s2 * SIN_2;
      s2 = n2;
    }
  }
}

const RIPPLE_1 = 0.37;
const RIPPLE_2 = 0.11;
const SIN_1 = Math.sin(RIPPLE_1);
const COS_1 = Math.cos(RIPPLE_1);
const SIN_2 = Math.sin(RIPPLE_2);
const COS_2 = Math.cos(RIPPLE_2);

/** Per-bin band index and spectral tilt, from each bin's position on a log-frequency axis. */
const BIN_BAND = new Uint8Array(SPECTRUM_MAX_BIN);
const BIN_TILT = new Float32Array(SPECTRUM_MAX_BIN);
for (let bin = 1; bin < SPECTRUM_MAX_BIN; bin++) {
  const x = Math.log2(bin) / Math.log2(BIN_COUNT);
  BIN_BAND[bin] = Math.min(BAND_COUNT - 1, Math.floor(x * BAND_COUNT));
  BIN_TILT[bin] = 1 - x * 0.55;
}
