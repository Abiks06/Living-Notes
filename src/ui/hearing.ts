import { audioFeatures } from '../audio/features';
import { VIBES } from '../audio/mood';
import { TEMPO_LOCKED } from '../audio/tempo';

const CLEAR_PITCH = 0.25;
const NOTES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** What the app is hearing right now, as text. A dash means it doesn't know, and says so. */
export function describeHearing(): { tempo: string; note: string; vibe: string; locked: boolean } {
  const a = audioFeatures;
  const locked = a.tempoConfidence >= TEMPO_LOCKED && a.bpm > 0;
  return {
    tempo: locked ? `${Math.round(a.bpm * a.grooveScale)} BPM` : '– BPM',
    note: a.pitchConfidence >= CLEAR_PITCH ? (NOTES[a.pitchClass] ?? '–') : '–',
    vibe: VIBES[a.vibe] ?? VIBES[0],
    locked,
  };
}
