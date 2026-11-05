import { clamp01 } from './envelope';

/** Below this nothing a file or demo contains is meaningful: digital silence, fade tails. */
const ABSOLUTE_GATE_DB = -60;
/** Sustained sound must rise this far above the measured room to count as signal. */
const NOISE_MARGIN_DB = 8;
/**
 * A single instant has to clear much more. Frame by frame a real room swings about 10 dB
 * around its average (measured on a laptop mic: p5 −47, p95 −41, spikes to −37 dBFS) while
 * its smoothed loudness holds within 3 dB, so judging instants like sustained sound would
 * leave the gate chattering on nothing. A clap still lands 20 dB or more above the room.
 */
const TRANSIENT_MARGIN_DB = 14;
/**
 * Sustained level is averaged in dB, not power. A power average is ruled by its loudest
 * instant, so one clap would prop the gate open for seconds and room noise would fire beats
 * through the gap; in dB that clap barely registers, while real sound still arrives in ~0.5 s.
 */
const SUSTAIN_TAU_S = 0.3;
/** Quick enough that room noise can't fire a second beat in the wake of a clap. */
const GATE_RELEASE_S = 0.2;
/** The room estimate may not climb past this, so loud sustained music can't gate itself. */
const NOISE_FLOOR_CAP_DB = -42;
const NOISE_RISE_DB_PER_S = 2;
/** Long enough to outlast a driver fading the stream in, which can take half a second. */
const NOISE_CALIBRATION_S = 2;
/** No real microphone is this quiet: it's a stream that hasn't started, or a driver's own gate. */
const DIGITAL_SILENCE_DB = -100;

/** Loudness two sections apart is compared across this range. */
const INTENSITY_RANGE_DB = 20;
/** The loudest recent level fades slowly, so a chorus is remembered through a verse. */
const REFERENCE_FALL_DB_PER_S = 0.35;
/**
 * The reference never falls below a typical programme level. Without this a track that
 * opens quietly would read as full scale, leaving the first real hit nowhere to go.
 */
const FILE_ANCHOR_DB = -28;
const LIVE_ANCHOR_DB = -38;
const SILENCE_DB = -120;

function toDb(power: number): number {
  return power > 1e-12 ? 10 * Math.log10(power) : SILENCE_DB;
}

/** 0 well under the threshold, 1 well over it, with a soft knee between. */
function openness(db: number, thresholdDb: number): number {
  const x = clamp01((db - (thresholdDb - 3)) / 6);
  return x * x * (3 - 2 * x);
}

/**
 * Macro dynamics, kept separate from the per-band auto-gain. Auto-gain answers "how is
 * this band moving right now" and deliberately forgets level within seconds; this answers
 * "how loud is this section compared with the rest", and "is anything playing at all".
 */
export class DynamicsTracker {
  /** 0 = silence or room noise, 1 = real signal. */
  gate = 0;
  /** 0–1: this section's loudness relative to the loudest recent section. */
  intensity = 0;
  /** Short-term loudness in dBFS. */
  loudnessDb = SILENCE_DB;

  private live = false;
  private shortPower = 0;
  private peakDb = SILENCE_DB;
  private sustainDb = SILENCE_DB;
  private referenceDb = FILE_ANCHOR_DB;
  private noiseFloorDb = SILENCE_DB;
  private listened = 0;
  private listenedEnergy = 0;

  reset(live: boolean): void {
    this.live = live;
    this.gate = 0;
    this.intensity = 0;
    this.shortPower = 0;
    this.peakDb = SILENCE_DB;
    this.sustainDb = SILENCE_DB;
    this.referenceDb = live ? LIVE_ANCHOR_DB : FILE_ANCHOR_DB;
    this.noiseFloorDb = SILENCE_DB;
    this.listened = 0;
    this.listenedEnergy = 0;
  }

  /** @param rms Root-mean-square of the latest samples, full scale = 1. */
  update(rms: number, dt: number): void {
    const power = rms * rms;
    const db = toDb(power);

    // Short-term loudness: rises quickly, relaxes over half a second.
    const tau = power > this.shortPower ? 0.15 : 0.5;
    this.shortPower += (power - this.shortPower) * (1 - Math.exp(-dt / tau));
    this.loudnessDb = toDb(this.shortPower);

    if (this.live) this.trackRoom(db, power, dt);

    // The held peak is what lets one clap through on its first frame.
    this.peakDb = Math.max(db, this.peakDb - 40 * dt);
    this.sustainDb += (db - this.sustainDb) * (1 - Math.exp(-dt / SUSTAIN_TAU_S));
    // Until the room is known, assume the loudest one allowed: a clap still gets through,
    // and the room itself can't open the gate while it's being measured.
    const room = this.listened < NOISE_CALIBRATION_S ? NOISE_FLOOR_CAP_DB : this.noiseFloorDb;
    const open = this.live
      ? Math.max(
          openness(this.peakDb, Math.max(ABSOLUTE_GATE_DB, room + TRANSIENT_MARGIN_DB)),
          openness(this.sustainDb, Math.max(ABSOLUTE_GATE_DB, room + NOISE_MARGIN_DB)),
        )
      : openness(this.peakDb, ABSOLUTE_GATE_DB);
    this.gate +=
      (open - this.gate) * (1 - Math.exp(-dt / (open > this.gate ? 0.01 : GATE_RELEASE_S)));

    const anchor = this.live ? LIVE_ANCHOR_DB : FILE_ANCHOR_DB;
    this.referenceDb = Math.max(
      this.loudnessDb,
      anchor,
      this.referenceDb - REFERENCE_FALL_DB_PER_S * dt,
    );
    this.intensity = clamp01(1 + (this.loudnessDb - this.referenceDb) / INTENSITY_RANGE_DB);
  }

  /** Estimates the room: quiet moments pull it down fast, sustained sound lifts it slowly. */
  private trackRoom(db: number, power: number, dt: number): void {
    // A new stream opens on digital zeros. Learning those as the room would leave the floor
    // far too low, and at the rise rate below the gate would stay open for half a minute.
    if (db <= DIGITAL_SILENCE_DB) return;
    if (this.listened < NOISE_CALIBRATION_S) {
      // Average power, so a driver fading in can't drag the floor down. Any clap in this
      // window lifts it too far, which the fast fall below soon corrects.
      this.listened += dt;
      this.listenedEnergy += power * dt;
      this.noiseFloorDb = Math.min(toDb(this.listenedEnergy / this.listened), NOISE_FLOOR_CAP_DB);
    } else if (db < this.noiseFloorDb) {
      this.noiseFloorDb += (db - this.noiseFloorDb) * (1 - Math.exp(-dt / 0.5));
    } else {
      this.noiseFloorDb = Math.min(
        NOISE_FLOOR_CAP_DB,
        this.noiseFloorDb + NOISE_RISE_DB_PER_S * dt,
      );
    }
  }
}
