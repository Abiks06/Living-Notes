/** Confidence above which beat-locked behaviour is safe. */
export const TEMPO_LOCKED = 0.55;

const RATE = 60;
const WINDOW = RATE * 8;
const MIN_LAG = RATE / 3; // 180 BPM
const MAX_LAG = RATE; // 60 BPM
const ANALYSIS_EVERY = RATE / 2;
const MIN_HISTORY = RATE * 4;
/** Half-tempo and double-tempo both correlate; music clusters around this, so prefer it. */
const PREFERRED_BPM = 120;
const PREFERENCE_OCTAVES = 1;
/** Onsets register this many samples late, as a hit has to enter the FFT window first. */
const DETECTION_LAG = 1.5;
/** A new tempo must be heard twice in a row before it replaces the current one. */
const SAME_TEMPO_RATIO = 0.04;

/**
 * Live tempo and beat phase, from autocorrelation of the onset envelope over the last 8 s.
 * It locks to a pulse rather than reacting after each hit, so motion can land *on* beats.
 * Free-time music has no stable pulse, and `confidence` stays low to say so: anything
 * beat-locked must fall back rather than invent a groove.
 *
 * Measured: steady grooves score 0.67–1, free-time piano about 0.25.
 */
export class TempoTracker {
  bpm = 0;
  /** 0–1 through the current beat; 0 is on the beat. */
  phase = 0;
  /** 0–1. Below `TEMPO_LOCKED` there is no reliable pulse. */
  confidence = 0;
  /** Counts beats since tracking began. */
  beatIndex = 0;

  private readonly envelope = new Float32Array(WINDOW);
  private readonly linear = new Float32Array(WINDOW);
  private readonly correlation = new Float32Array(MAX_LAG * 4 + 8);
  private head = 0;
  private filled = 0;
  private sinceAnalysis = 0;
  private accumulator = 0;
  private period = 0; // samples per beat
  private pendingPeriod = 0;
  /** Beats so far, never wrapped, so a correction across the beat can't recount it. */
  private position = 0;

  update(flux: number, dt: number): void {
    this.accumulator += dt;
    while (this.accumulator >= 1 / RATE) {
      this.accumulator -= 1 / RATE;
      this.envelope[this.head] = flux;
      this.head = (this.head + 1) % WINDOW;
      this.filled = Math.min(WINDOW, this.filled + 1);
      this.sinceAnalysis++;
    }

    if (this.period > 0) this.moveBy((dt * RATE) / this.period);

    if (this.sinceAnalysis >= ANALYSIS_EVERY && this.filled >= MIN_HISTORY) {
      this.sinceAnalysis = 0;
      this.analyze();
    }
  }

  private moveBy(beats: number): void {
    this.position += beats;
    const whole = Math.floor(this.position);
    this.phase = this.position - whole;
    this.beatIndex = Math.max(this.beatIndex, whole);
  }

  reset(): void {
    this.envelope.fill(0);
    this.head = 0;
    this.filled = 0;
    this.period = 0;
    this.pendingPeriod = 0;
    this.bpm = 0;
    this.confidence = 0;
  }

  private analyze(): void {
    const n = this.filled;
    const x = this.linear;
    let mean = 0;
    const start = (this.head - n + WINDOW) % WINDOW;
    for (let i = 0; i < n; i++) {
      const value = this.envelope[(start + i) % WINDOW] ?? 0;
      x[i] = value;
      mean += value;
    }
    mean /= n;
    for (let i = 0; i < n; i++) x[i] = (x[i] ?? 0) - mean;

    let zero = 0;
    for (let i = 0; i < n; i++) zero += (x[i] ?? 0) ** 2;
    if (zero <= 1e-9) {
      this.confidence *= 0.7;
      return;
    }

    let bestLag = 0;
    let bestScore = 0;
    for (let lag = MIN_LAG; lag <= MAX_LAG; lag++) {
      const r = this.correlate(lag, n);
      // A real pulse also repeats at twice its period; a chance match usually doesn't.
      const r2 = this.correlate(lag * 2, n);
      const octaves = Math.log2((RATE * 60) / lag / PREFERRED_BPM) / PREFERENCE_OCTAVES;
      const score = Math.max(0, r + 0.5 * r2) * Math.exp(-0.5 * octaves * octaves);
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }
    if (bestLag === 0) {
      this.confidence *= 0.7;
      return;
    }

    const period = this.refine(bestLag, n);
    // Sparse grooves repeat by the bar more clearly than by the beat.
    const repeat = Math.max(
      this.correlate(bestLag, n),
      this.correlate(bestLag * 2, n),
      this.correlate(bestLag * 4, n),
    );
    const strength = Math.max(0, repeat) / zero;
    this.confidence += (Math.min(1, strength * 1.6) - this.confidence) * 0.35;

    if (this.period === 0 || Math.abs(period / this.period - 1) < SAME_TEMPO_RATIO) {
      this.period = this.period === 0 ? period : this.period + (period - this.period) * 0.25;
    } else if (Math.abs(period / (this.pendingPeriod || period) - 1) < SAME_TEMPO_RATIO) {
      if (this.pendingPeriod !== 0) this.period = period;
      this.pendingPeriod = period;
    } else {
      this.pendingPeriod = period;
    }
    this.bpm = (RATE * 60) / this.period;
    this.alignPhase(n);
  }

  private correlate(lag: number, n: number): number {
    const cached = this.correlation;
    const x = this.linear;
    let sum = 0;
    for (let i = lag; i < n; i++) sum += (x[i] ?? 0) * (x[i - lag] ?? 0);
    const value = (sum * n) / (n - lag);
    cached[lag] = value;
    return value;
  }

  /** Measures across four beats, which quarters the rounding error of one sample. */
  private refine(lag: number, n: number): number {
    const span = lag * 4;
    if (span + 3 >= n) return lag;
    let best = span;
    let bestValue = -Infinity;
    for (let candidate = span - 3; candidate <= span + 3; candidate++) {
      const value = this.correlate(candidate, n);
      if (value > bestValue) {
        bestValue = value;
        best = candidate;
      }
    }
    const left = this.correlate(best - 1, n);
    const right = this.correlate(best + 1, n);
    const curve = left - 2 * bestValue + right;
    const offset = curve !== 0 ? (0.5 * (left - right)) / curve : 0;
    return (best + Math.max(-1, Math.min(1, offset))) / 4;
  }

  /** Slides a comb of beat-spaced teeth over the recent envelope to find where beats fall. */
  private alignPhase(n: number): void {
    const x = this.linear;
    const period = this.period;
    let bestOffset = 0;
    let bestSum = -Infinity;
    for (let offset = 0; offset < period; offset++) {
      let sum = 0;
      for (let position = n - 1 - offset; position >= 0; position -= period) {
        sum += x[Math.round(position)] ?? 0;
      }
      if (sum > bestSum) {
        bestSum = sum;
        bestOffset = offset;
      }
    }
    const target = (bestOffset + DETECTION_LAG) / period;
    let error = target - this.phase;
    if (error > 0.5) error -= 1;
    if (error < -0.5) error += 1;
    this.moveBy(error * 0.5);
  }
}
