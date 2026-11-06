/** The song to carry on with, saved as it plays. */
export interface ResumePoint {
  id: string;
  title: string;
  artist: string;
  position: number;
}

/** Near either end of a song there's nothing to carry on from, so it just starts again. */
const EDGE_S = 10;
const DROPPED = 'dropped/';

/** Where to pick a song back up. */
export function resumeFrom(position: number, duration: number): number {
  const known = duration > 0;
  if (position < EDGE_S || (known && duration - position < EDGE_S)) return 0;
  return position;
}

/** Songs dropped in for one visit won't be there next time. */
export function canResume(id: string): boolean {
  return !id.startsWith(DROPPED);
}
