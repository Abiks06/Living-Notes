/** Confidence above which transitions may wait for the 1. */
export const BAR_LOCKED = 0.5;

/** Beats per bar. Odd meters read as a low `barConfidence` rather than a wrong bar. */
const BAR = 4;
/** Each beat keeps this much of what was heard, so a bar's shape is learned over ~8 bars. */
const BEAT_MEMORY = 0.97;
/** Hits further from a beat than this (in beats) are syncopation, and don't mark the bar. */
const ON_BEAT = 0.2;
const MIN_SNARES = 3;
const MIN_KICKS = 4;
/** Below this ratio of its partner, a backbeat is missing: snare on 3 alone, so half-time. */
const HALF_TIME_RATIO = 0.35;
/** Halving a slower groove would nod at under 55 BPM, slower than anyone's head moves. */
const HALF_TIME_MIN_BPM = 110;

/**
 * Finds the bar inside the beat grid. `beatIndex` starts wherever tracking happened to begin,
 * so on its own it says nothing about which beat is the 1. The drums do: snares mark 2 and 4,
 * or 3 alone in half-time, and kicks favour the 1.
 *
 * Four-on-the-floor has no kick to tell 1 from 3, so there the bar may be a half-bar out.
 * Changes still land on a strong beat, which is what the eye picks up.
 */
export class BarTracker {
  /** 0–3 position in the bar; 0 is the 1. */
  barBeat = 0;
  /** 0–1. Below `BAR_LOCKED` the bar is a guess, and nothing should wait for it. */
  confidence = 0;
  /** 1 normally, 0.5 when the groove is felt at half the tempo. */
  grooveScale = 1;
  /** 0–1 through the felt beat, which is two beats long in half-time. */
  groovePhase = 0;
  /** Counts felt beats. */
  feltBeat = 0;

  private readonly snares = new Float32Array(BAR);
  private readonly kicks = new Float32Array(BAR);
  private downbeat = 0;
  private lastBeat = -1;

  update(
    beatIndex: number,
    phase: number,
    bpm: number,
    locked: boolean,
    kickHit: boolean,
    snareHit: boolean,
  ): void {
    if (beatIndex !== this.lastBeat) {
      this.lastBeat = beatIndex;
      for (let i = 0; i < BAR; i++) {
        this.snares[i] = (this.snares[i] ?? 0) * BEAT_MEMORY;
        this.kicks[i] = (this.kicks[i] ?? 0) * BEAT_MEMORY;
      }
      if (locked) this.analyse(bpm);
      else this.confidence *= BEAT_MEMORY;
    }

    if (Math.min(phase, 1 - phase) < ON_BEAT) {
      const slot = (beatIndex + (phase > 0.5 ? 1 : 0)) % BAR;
      if (kickHit) this.kicks[slot] = (this.kicks[slot] ?? 0) + 1;
      if (snareHit) this.snares[slot] = (this.snares[slot] ?? 0) + 1;
    }

    this.barBeat = (((beatIndex - this.downbeat) % BAR) + BAR) % BAR;
    if (this.grooveScale < 1) {
      this.groovePhase = ((this.barBeat % 2) + phase) / 2;
      this.feltBeat = Math.floor((beatIndex - this.downbeat) / 2);
    } else {
      this.groovePhase = phase;
      this.feltBeat = beatIndex;
    }
  }

  reset(): void {
    this.snares.fill(0);
    this.kicks.fill(0);
    this.confidence = 0;
    this.grooveScale = 1;
    this.lastBeat = -1;
  }

  private analyse(bpm: number): void {
    const s = this.snares;
    const k = this.kicks;
    const at = (list: Float32Array, slot: number) => list[slot % BAR] ?? 0;
    const evens = at(s, 0) + at(s, 2);
    const odds = at(s, 1) + at(s, 3);
    const total = evens + odds;

    if (total >= MIN_SNARES) {
      const back = evens >= odds ? 0 : 1;
      const first = at(s, back);
      const second = at(s, back + 2);
      const lone = (first > second ? back : back + 2) % BAR;
      const heaviestKick = Math.max(at(k, 0), at(k, 1), at(k, 2), at(k, 3));
      // A kick under the snare means four-on-the-floor or a straight groove, never half-time.
      const half =
        Math.min(first, second) < Math.max(first, second) * HALF_TIME_RATIO &&
        at(k, lone) < heaviestKick * 0.5;
      this.confidence = Math.min(1, Math.max(0, (Math.max(evens, odds) / total - 0.6) / 0.3));

      if (half) {
        // The lone snare is beat 3.
        this.downbeat = (lone + 2) % BAR;
        // A wrong nod speed is far more visible than a missed one, so it has to be sure.
        const sure = this.confidence >= BAR_LOCKED && bpm >= HALF_TIME_MIN_BPM;
        this.grooveScale = sure ? 0.5 : 1;
        return;
      }
      this.grooveScale = 1;
      // Snares are on 2 and 4, so 1 and 3 are the other pair, and the 1 has the heavier kick.
      const one = (back + 1) % BAR;
      const three = (back + 3) % BAR;
      const lead = at(k, one) - at(k, three);
      if (Math.abs(lead) > 0.5) this.downbeat = lead > 0 ? one : three;
      else if (this.downbeat !== one && this.downbeat !== three) this.downbeat = one;
      return;
    }

    // No backbeat to go on: a kick that keeps coming back to one slot is the next best thing.
    this.grooveScale = 1;
    let best = 0;
    let sum = 0;
    for (let i = 0; i < BAR; i++) {
      sum += at(k, i);
      if (at(k, i) > at(k, best)) best = i;
    }
    const share = sum > 0 ? at(k, best) / sum : 0;
    if (sum >= MIN_KICKS && share > 0.45) {
      this.downbeat = best;
      this.confidence = 0.6;
    } else {
      this.confidence *= BEAT_MEMORY;
    }
  }
}

/** Regular kicks needed before a gap means anything. */
const MIN_KICK_HITS = 6;
/** A kick this much later than the longest recent gap has gone missing. */
const LATE_RATIO = 1.35;
/** Short enough that a run of quick kicks can't call an ordinary gap a vacuum. */
const MIN_VACUUM_S = 0.55;
/** Only a driving groove can hold its breath. Sparse kicks leave gaps as a matter of course. */
const MAX_DRIVING_GAP_S = 0.9;
/** A vacuum is a held breath: past this it's a breakdown, and the music has moved on. */
const MAX_VACUUM_S = 3;
const GAP_MEMORY = 0.9;
const INHALE_ATTACK_S = 0.22;
const INHALE_RELEASE_S = 0.08;

/**
 * The breath before a drop. Most drops are set up by taking the low end away for a beat or
 * two, which the ear hears as a kick that should have landed and didn't. So this watches for
 * exactly that, measured against the song's own longest recent gap: a level check would fire
 * between every kick, and sparse trap patterns have long gaps as a matter of course.
 */
export class InhaleTracker {
  /** 0–1: how far into the held breath the music is. */
  inhale = 0;

  private sinceKick = 0;
  private longestGap = 0;
  private hits = 0;

  update(dt: number, kickHit: boolean, gate: number): void {
    this.sinceKick += dt;

    if (kickHit) {
      // Even a gap that ended a breath counts: if long gaps are normal here, it must learn so.
      this.longestGap = Math.max(this.sinceKick, this.longestGap * GAP_MEMORY);
      this.sinceKick = 0;
      this.hits++;
    }

    const due = Math.max(MIN_VACUUM_S, this.longestGap * LATE_RATIO);
    const holding =
      this.hits >= MIN_KICK_HITS &&
      this.longestGap <= MAX_DRIVING_GAP_S &&
      gate > 0.3 &&
      this.sinceKick > due &&
      this.sinceKick < due + MAX_VACUUM_S;
    const tau = holding ? INHALE_ATTACK_S : INHALE_RELEASE_S;
    this.inhale += ((holding ? 1 : 0) - this.inhale) * (1 - Math.exp(-dt / tau));
  }

  reset(): void {
    this.inhale = 0;
    this.sinceKick = 0;
    this.longestGap = 0;
    this.hits = 0;
  }
}
