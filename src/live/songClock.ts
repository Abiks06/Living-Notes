/** Enough reports to see past the jitter, few enough to settle within a few seconds. */
const KEPT = 9;
/** Further than this from where the song was thought to be is a seek, not jitter. */
const JUMP_S = 1.2;

/**
 * Where a song playing in another app really is. Each report from Windows pairs a position with
 * the time it was taken, and browsers get that pairing wrong by a few tenths of a second either
 * way, differently every time. Following the latest report made lyrics lurch early and late.
 * The middle of the recent reports is steady, and a real seek still shows as a jump.
 */
export class SongClock {
  /** Each report as the moment the song would have started, in seconds. */
  private starts: number[] = [];
  private playing = false;

  /**
   * @param position Seconds into the song, as reported.
   * @param at When that was true, in milliseconds.
   * @returns The same moment, steadied: a position to carry forward from `at`.
   */
  report(position: number, at: number, playing: boolean): number {
    const start = at / 1000 - position;
    const middle = this.middle();
    // Paused time is no part of the song, so a pause or a seek starts the count again.
    if (playing !== this.playing || (middle !== null && Math.abs(start - middle) > JUMP_S)) {
      this.starts = [];
    }
    this.playing = playing;
    if (this.starts[this.starts.length - 1] !== start) this.starts.push(start);
    if (this.starts.length > KEPT) this.starts.shift();
    return at / 1000 - (this.middle() ?? start);
  }

  private middle(): number | null {
    if (this.starts.length === 0) return null;
    const sorted = [...this.starts].sort((a, b) => a - b);
    const half = sorted.length >> 1;
    const value =
      sorted.length % 2 ? sorted[half] : ((sorted[half - 1] ?? 0) + (sorted[half] ?? 0)) / 2;
    return value ?? null;
  }
}
