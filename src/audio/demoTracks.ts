import type { PatternId } from './synth/patterns';

export interface DemoTrack {
  readonly id: string;
  readonly title: string;
  readonly mood: string;
  /** Drop a real royalty-free file here (public/audio/...) to replace the synth loop. */
  readonly url: string;
  /** Procedural loop used when `url` isn't available. */
  readonly fallback: PatternId;
  /** A full composed song with real stems, rather than a loop. */
  readonly proof?: boolean;
}

export const DEMO_TRACKS: readonly DemoTrack[] = [
  {
    id: 'afterglow',
    title: 'Afterglow',
    mood: 'Full song · 100',
    url: '',
    fallback: 'pulse',
    proof: true,
  },
  {
    id: 'pulse',
    title: 'Pulse Engine',
    mood: 'House · 124',
    url: '/audio/demo-1.mp3',
    fallback: 'pulse',
  },
  {
    id: 'drift',
    title: 'Night Drift',
    mood: 'Half-time · 88',
    url: '/audio/demo-2.mp3',
    fallback: 'drift',
  },
  {
    id: 'shatter',
    title: 'Glass Shatter',
    mood: 'Breaks · 140',
    url: '/audio/demo-3.mp3',
    fallback: 'shatter',
  },
  {
    id: 'still',
    title: 'Still Water',
    mood: 'Ambient · free',
    url: '/audio/demo-4.mp3',
    fallback: 'still',
  },
];

/** Opens on something instant and loud: Afterglow takes a moment to render and starts quietly. */
export const DEFAULT_DEMO = DEMO_TRACKS.find((track) => track.id === 'pulse') as DemoTrack;

export function findDemo(id: string): DemoTrack | undefined {
  return DEMO_TRACKS.find((track) => track.id === id);
}

const availability = new Map<string, Promise<boolean>>();

/**
 * Checks once whether a bundled file exists. SPA hosts often answer unknown paths
 * with index.html, so require an audio content type rather than just a 200.
 */
export function isTrackFileAvailable(track: DemoTrack): Promise<boolean> {
  let check = availability.get(track.id);
  if (!check) {
    check = fetch(track.url, { method: 'HEAD' })
      .then((res) => res.ok && (res.headers.get('content-type') ?? '').startsWith('audio/'))
      .catch(() => false);
    availability.set(track.id, check);
  }
  return check;
}
