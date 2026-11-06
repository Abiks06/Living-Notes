/**
 * The song's shape, worked out as it plays. A score reads this from the whole song; live sound
 * has only what's been heard so far, so everything here is judged against the song's own recent
 * past. It can't know a drop is coming, but it can tell one when it lands: the low end has been
 * taken away, and it comes back all at once on a kick.
 *
 * Levels are the analyser's byte spectrum as 0-1, which is a decibel scale, so differences here
 * are differences in loudness and don't depend on how loud the source happens to be.
 */

/** How quickly each view of the sound follows it. */
const FAST_S = 0.07;
const BASE_S = 2.2;
const HOLD_S = 1.6;
/** How long the song's biggest and smallest moments are remembered. */
const RANGE_FALL_PER_S = 0.0012;
const MIN_RANGE = 0.05;
/** Until the song has shown its range, assume it's somewhere in the upper half. */
const UNKNOWN_PRESENCE = 0.7;
const RANGE_KNOWN_S = 8;
const PRESENCE_CURVE = 1.4;

/**
 * A drop has to out-jump what an ordinary hit does in this song. In a sparse song every kick is a
 * big jump over the quiet before it, so the bar sits high; under a steady four-to-the-floor kick
 * it sits low. This is how far back "ordinary" looks.
 */
const MEMORY_S = 20;
/** The moment itself is left out, or a drop would be measured against its own start. */
const SKIP_S = 0.5;
const SLOT_S = 0.1;
const OUT_JUMP = 0.05;
/** How far the low end must be below its best before anything counts as a dip. */
const DIP = 0.09;
/** How far above its recent level the sound must jump, in one go, to land as a drop. */
const LOW_RISE = 0.13;
const FULL_RISE = 0.03;
/** A drop has to land on a kick, or very near one. */
const KICK_WINDOW_S = 0.2;
const EARLIEST_S = 8;
/** A drop arrives at the song's biggest, so it has to get close to the best low end so far. */
const TOP_MARGIN = 0.1;
const MIN_GAP_S = 10;

const IMPACT_DECAY_S = 0.55;
const MIN_POWER = 0.6;
const FULL_POWER_RISE = 0.28;
/** A climb is the sound rising out of a dip, by this much at its peak. A flat dip is a verse. */
const CLIMB_RISE = 0.13;
const MAX_TENSION = 0.8;
const TENSION_FALL_S = 1.5;
/** The bigger section a drop opens lasts until the sound falls this far from it. */
const WORLD_END = 0.06;
const WORLD_EASE_S = 0.8;

const SLOTS = Math.round(MEMORY_S / SLOT_S);
const SKIPPED = Math.round(SKIP_S / SLOT_S);

/** The biggest values of the last few seconds, a tenth of a second at a time. */
class RecentPeak {
  private readonly slots = new Float32Array(SLOTS);
  private slot = 0;
  private filled = 0;

  add(value: number, dt: number): void {
    this.filled += dt;
    if (this.filled >= SLOT_S) {
      this.filled -= SLOT_S;
      this.slot = (this.slot + 1) % SLOTS;
      this.slots[this.slot] = 0;
    }
    this.slots[this.slot] = Math.max(this.slots[this.slot] ?? 0, value);
  }

  /** The highest of them, leaving out the moment that's happening now. */
  get peak(): number {
    let highest = 0;
    for (let age = SKIPPED; age < SLOTS; age++) {
      highest = Math.max(highest, this.slots[(this.slot - age + SLOTS) % SLOTS] ?? 0);
    }
    return highest;
  }

  reset(): void {
    this.slots.fill(0);
    this.slot = 0;
    this.filled = 0;
  }
}

const follow = (value: number, target: number, dt: number, seconds: number) =>
  value + (target - value) * (1 - Math.exp(-dt / seconds));
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export class LiveForm {
  /** 0-1 how big this moment is, against the song so far. */
  presence = UNKNOWN_PRESENCE;
  /** 0-1 the climb out of a breakdown. */
  tension = 0;
  /** 0-1 the section a drop opened. */
  world = 0;
  /** 0-1 the drop itself, decaying. */
  impact = 0;
  /** 0-1 how big the last drop was. */
  dropPower = 1;

  private heard = 0;
  private lowFast = 0;
  private lowBase = 0;
  private readonly jumps = new RecentPeak();
  private lowTop = 0;
  private fullFast = 0;
  private fullBase = 0;
  private hold = 0;
  private holdTop = 0;
  private holdBottom = 1;
  private sinceKick = Infinity;
  private sinceDrop = Infinity;
  private dipFloor = 1;
  /** A drop ends its dip, though the average takes a few seconds to agree. */
  private dipOver = false;
  private worldTarget = 0;
  private worldLevel = 0;

  /** @param levels Band levels, 0-1, on the analyser's decibel scale, sub bass first. */
  update(levels: Float32Array, kickHit: boolean, gate: number, dt: number): void {
    this.impact = Math.max(0, this.impact - dt / IMPACT_DECAY_S);
    if (gate < 0.3) {
      this.tension = follow(this.tension, 0, dt, TENSION_FALL_S);
      return;
    }

    const low = ((levels[0] ?? 0) + (levels[1] ?? 0)) / 2;
    const full =
      low * 0.5 +
      ((levels[2] ?? 0) + (levels[3] ?? 0)) * 0.15 +
      ((levels[4] ?? 0) + (levels[5] ?? 0)) * 0.1;
    if (this.heard === 0) {
      this.lowFast = this.lowBase = low;
      this.fullFast = this.fullBase = this.hold = full;
    }
    this.heard += dt;
    this.sinceDrop += dt;
    this.sinceKick = kickHit ? 0 : this.sinceKick + dt;

    this.lowFast = follow(this.lowFast, low, dt, FAST_S);
    this.fullFast = follow(this.fullFast, full, dt, FAST_S);
    this.hold = follow(this.hold, full, dt, HOLD_S);
    this.lowTop = Math.max(this.lowFast, this.lowTop - RANGE_FALL_PER_S * dt);
    this.holdTop = Math.max(this.hold, this.holdTop - RANGE_FALL_PER_S * dt);
    this.holdBottom = Math.min(this.hold, this.holdBottom + RANGE_FALL_PER_S * dt);

    const dipped = this.lowTop - this.lowBase >= DIP;
    if (!dipped) this.dipOver = false;
    this.dipFloor = dipped && !this.dipOver ? Math.min(this.dipFloor, this.hold) : 1;

    const lowRise = this.lowFast - this.lowBase;
    const fullRise = this.fullFast - this.fullBase;
    const ordinary = this.jumps.peak;
    this.jumps.add(lowRise, dt);
    const landed =
      dipped &&
      lowRise >= LOW_RISE &&
      lowRise >= ordinary + OUT_JUMP &&
      fullRise >= FULL_RISE &&
      this.lowFast >= this.lowTop - TOP_MARGIN &&
      this.sinceKick <= KICK_WINDOW_S &&
      this.heard >= EARLIEST_S &&
      this.sinceDrop >= MIN_GAP_S;
    if (landed) this.land(lowRise);

    // The averages only follow once a drop has been called, so a drop can't hide its own rise.
    this.lowBase = follow(this.lowBase, low, dt, BASE_S);
    this.fullBase = follow(this.fullBase, full, dt, BASE_S);

    this.writeShape(dt);
  }

  private land(rise: number): void {
    this.impact = 1;
    this.sinceDrop = 0;
    this.dipFloor = 1;
    this.dipOver = true;
    this.dropPower = MIN_POWER + (1 - MIN_POWER) * clamp01(rise / FULL_POWER_RISE);
    this.worldTarget = this.dropPower;
    this.worldLevel = this.fullFast;
    // The big section starts now, not once a slow average has caught up with it.
    this.hold = Math.max(this.hold, this.fullFast);
  }

  private writeShape(dt: number): void {
    const range = this.holdTop - this.holdBottom;
    const place = range >= MIN_RANGE ? (this.hold - this.holdBottom) / range : UNKNOWN_PRESENCE;
    const known = clamp01(this.heard / RANGE_KNOWN_S);
    const shaped = clamp01(place) ** PRESENCE_CURVE;
    this.presence = UNKNOWN_PRESENCE + (shaped - UNKNOWN_PRESENCE) * known;

    const x = clamp01((this.hold - this.dipFloor) / CLIMB_RISE);
    const climb = x * x * MAX_TENSION;
    this.tension = climb > this.tension ? climb : follow(this.tension, climb, dt, TENSION_FALL_S);

    if (this.fullFast < this.worldLevel - WORLD_END) this.worldTarget = 0;
    this.world = follow(this.world, this.worldTarget, dt, WORLD_EASE_S);
  }

  reset(): void {
    this.presence = UNKNOWN_PRESENCE;
    this.tension = 0;
    this.world = 0;
    this.impact = 0;
    this.dropPower = 1;
    this.heard = 0;
    this.lowFast = 0;
    this.lowBase = 0;
    this.jumps.reset();
    this.lowTop = 0;
    this.fullFast = 0;
    this.fullBase = 0;
    this.hold = 0;
    this.holdTop = 0;
    this.holdBottom = 1;
    this.sinceKick = Infinity;
    this.sinceDrop = Infinity;
    this.dipFloor = 1;
    this.dipOver = false;
    this.worldTarget = 0;
    this.worldLevel = 0;
  }
}
