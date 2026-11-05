import { BAND_COUNT, type BandLayout, NO_BAND } from './bands';
import { clamp01 } from './envelope';
import { AMPLITUDE } from './tone';

const HISTORY = 48; // ~0.8 s at 60 FPS
const THRESHOLD_SIGMA = 1.6;
/** Share of the new energy that must be low for a hit to count as a kick. */
const KICK_SHARE = 0.6;
/**
 * A kick and a clap land together on 2 and 4 in most pop and house, so the two can't be
 * either/or. But the kick has about 70× the energy, and a kick alone lifts the snare band
 * too, by an amount that depends entirely on the mix. So each track teaches its own leak:
 * how much of the snare band its plain kicks reach. A low hit counts as a snare as well
 * only if it clearly beats that. Measured: kick alone 0.15, kick plus clap 0.30.
 */
const SNARE_OVER_LEAK = 1.4;
/**
 * The leak follows the quiet end of a track's low hits, as the noise gate follows a room: it
 * drops straight to any lower hit and creeps up on higher ones. Hits that fired a snare still
 * count, or a track's first low reading would turn every later kick into a clap.
 */
const LEAK_CREEP = 0.15;
/** How long after the kick detector fires its snare-band flux counts as that kick's. */
const KICK_HIT_S = 0.07;
/** Energy rise is compared over this long, as a hit's bands don't all peak on one frame. */
const RISE_MEMORY_S = 0.05;

/** Sub-bass and bass. */
const LOW_BANDS = 2;

interface ChannelOptions {
  /** Band weights: which part of the spectrum this detector listens to. */
  weights: readonly number[];
  minFlux: number;
  refractoryS: number;
  pulseDecayS: number;
}

/**
 * One onset detector: half-wave rectified spectral flux against an adaptive
 * (mean + k·σ) threshold over a short rolling window, with a decaying pulse output.
 */
class OnsetChannel {
  pulse = 0;
  strength = 0;
  count = 0;
  flux = 0;

  private readonly history = new Float32Array(HISTORY);
  private readonly weightSum: number;
  private readonly options: ChannelOptions;
  private historyIndex = 0;
  private historyFilled = 0;
  private sinceOnset = Infinity;
  private armed = true;

  constructor(options: ChannelOptions) {
    this.options = options;
    this.weightSum = options.weights.reduce((a, b) => a + b, 0);
  }

  /** This frame's flux in the channel's bands, without advancing the detector. */
  measure(bandFlux: Float32Array, binCounts: Uint16Array): number {
    const { weights } = this.options;
    let flux = 0;
    for (let band = 0; band < BAND_COUNT; band++) {
      const bins = binCounts[band] ?? 0;
      const weight = weights[band] ?? 0;
      if (bins > 0 && weight > 0) flux += ((bandFlux[band] ?? 0) / (bins * 255)) * weight;
    }
    return flux / this.weightSum;
  }

  update(bandFlux: Float32Array, binCounts: Uint16Array, dt: number, allow: boolean): void {
    const { minFlux, refractoryS, pulseDecayS } = this.options;
    const flux = this.measure(bandFlux, binCounts);
    this.flux = flux;

    // Adaptive threshold from the window *before* this frame.
    let mean = 0;
    let variance = 0;
    const n = this.historyFilled;
    if (n > 0) {
      for (let i = 0; i < n; i++) mean += this.history[i] ?? 0;
      mean /= n;
      for (let i = 0; i < n; i++) {
        const d = (this.history[i] ?? 0) - mean;
        variance += d * d;
      }
      variance /= n;
    }
    const threshold = Math.max(minFlux, mean + THRESHOLD_SIGMA * Math.sqrt(variance));

    this.history[this.historyIndex] = flux;
    this.historyIndex = (this.historyIndex + 1) % HISTORY;
    this.historyFilled = Math.min(HISTORY, this.historyFilled + 1);

    this.sinceOnset += dt;
    this.pulse = Math.max(0, this.pulse - dt / pulseDecayS);

    // Re-arm once flux falls back under the threshold so one hit can't fire twice.
    if (flux < threshold) this.armed = true;

    if (allow && this.armed && n >= 8 && flux > threshold && this.sinceOnset > refractoryS) {
      this.armed = false;
      this.sinceOnset = 0;
      this.count++;
      this.strength = clamp01((flux - threshold) / threshold);
      this.pulse = Math.max(this.pulse, 0.65 + 0.35 * this.strength);
    }
  }

  reset(): void {
    this.history.fill(0);
    this.historyFilled = 0;
    this.historyIndex = 0;
    this.pulse = 0;
    this.strength = 0;
    this.armed = true;
  }
}

/**
 * Onsets from one pass over the spectrum, split by register. The broadband channel is the
 * spec's `beat`; the others let visuals tell low hits (kick, bass notes) from mid hits
 * (snare, clap, piano and guitar attacks) and from high hits (hats, cymbals), so a groove's
 * call and response stops collapsing into one gesture.
 */
export class BeatDetector {
  /** Low bands are few bins but carry the kick; weight them up so hats don't dominate. */
  readonly all = new OnsetChannel({
    weights: [1.6, 1.5, 1.0, 0.9, 0.8, 0.7],
    minFlux: 0.012,
    refractoryS: 0.13,
    pulseDecayS: 0.2,
  });
  readonly kick = new OnsetChannel({
    weights: [1, 1, 0, 0, 0, 0],
    minFlux: 0.03,
    refractoryS: 0.12,
    pulseDecayS: 0.22,
  });
  readonly snare = new OnsetChannel({
    weights: [0, 0, 0.3, 1, 1, 0],
    minFlux: 0.02,
    refractoryS: 0.1,
    pulseDecayS: 0.18,
  });
  readonly hat = new OnsetChannel({
    weights: [0, 0, 0, 0, 0, 1],
    minFlux: 0.015,
    refractoryS: 0.042,
    pulseDecayS: 0.09,
  });

  private readonly previous: Uint8Array;
  private readonly bandFlux = new Float32Array(BAND_COUNT);
  private readonly layout: BandLayout;
  private lowRise = 0;
  private upperRise = 0;
  private kickLeak = 0;
  private kickHitPeak = 0;
  private kickHitLeft = 0;

  constructor(layout: BandLayout, binCount: number) {
    this.layout = layout;
    this.previous = new Uint8Array(binCount);
  }

  /** @param allow False while gated: history keeps adapting, but nothing fires. */
  update(spectrum: Uint8Array, dt: number, allow: boolean): void {
    const { binToBand, binCounts } = this.layout;
    const bandFlux = this.bandFlux;
    bandFlux.fill(0);

    const memory = Math.exp(-dt / RISE_MEMORY_S);
    let lowRise = this.lowRise * memory;
    let upperRise = this.upperRise * memory;

    for (let bin = 0; bin < spectrum.length; bin++) {
      const value = spectrum[bin] ?? 0;
      const band = binToBand[bin] ?? NO_BAND;
      if (band !== NO_BAND) {
        const before = this.previous[bin] ?? 0;
        const diff = value - before;
        if (diff > 0) {
          bandFlux[band] = (bandFlux[band] ?? 0) + diff;
          const rise = (AMPLITUDE[value] ?? 0) ** 2 - (AMPLITUDE[before] ?? 0) ** 2;
          if (band < LOW_BANDS) lowRise += rise;
          else upperRise += rise;
        }
      }
      this.previous[bin] = value;
    }
    this.lowRise = lowRise;
    this.upperRise = upperRise;

    // Flux is in dB, so any broadband hit lifts every band and both channels would fire.
    // Which register a hit belongs to is decided by where its energy actually went.
    const low = lowRise / Math.max(lowRise + upperRise, 1e-12) >= KICK_SHARE;
    const snareFlux = this.snare.measure(bandFlux, binCounts);
    const layered = this.kickLeak > 0 && snareFlux > this.kickLeak * SNARE_OVER_LEAK;

    this.all.update(bandFlux, binCounts, dt, allow);
    const kicks = this.kick.count;
    this.kick.update(bandFlux, binCounts, dt, allow && low);
    if (this.kick.count !== kicks) this.kickHitLeft = KICK_HIT_S;
    this.learnLeak(snareFlux, dt);
    this.snare.update(bandFlux, binCounts, dt, allow && (!low || layered));
    this.hat.update(bandFlux, binCounts, dt, allow);
  }

  private learnLeak(snareFlux: number, dt: number): void {
    if (this.kickHitLeft <= 0) return;
    this.kickHitPeak = Math.max(this.kickHitPeak, snareFlux);
    this.kickHitLeft -= dt;
    if (this.kickHitLeft > 0) return;
    const peak = this.kickHitPeak;
    const lower = this.kickLeak === 0 || peak < this.kickLeak;
    this.kickLeak = lower ? peak : this.kickLeak + (peak - this.kickLeak) * LEAK_CREEP;
    this.kickHitPeak = 0;
  }

  reset(): void {
    this.previous.fill(0);
    this.lowRise = 0;
    this.upperRise = 0;
    this.kickLeak = 0;
    this.kickHitPeak = 0;
    this.kickHitLeft = 0;
    this.all.reset();
    this.kick.reset();
    this.snare.reset();
    this.hat.reset();
  }
}
