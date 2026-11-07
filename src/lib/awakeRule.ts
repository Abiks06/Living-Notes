/** Sits through a quiet passage or a gap between songs. After this the PC can sleep as usual. */
const QUIET_LIMIT_S = 300;

/** Fullscreen with music going is someone watching, even if they never touch the mouse. */
export class AwakeRule {
  private quietFor = Infinity;

  update(dt: number, fullscreen: boolean, hearing: boolean): boolean {
    this.quietFor = hearing ? 0 : this.quietFor + dt;
    return fullscreen && this.quietFor < QUIET_LIMIT_S;
  }
}
