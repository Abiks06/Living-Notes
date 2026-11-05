import type { AudioFeatures } from '../audio/features';
import { type Vibe, VIBES } from '../audio/mood';
import { BAR_LOCKED } from '../audio/phrasing';
import { TEMPO_LOCKED } from '../audio/tempo';
import { type CuratedPaletteKey, PALETTES, type PaletteKey } from '../settings/palettes';
import { SCENES, type SceneKey } from './scenes';

/** Changes never come closer together than this, however eventful the music is. */
const MIN_HOLD_S = 12;
/** Without a clear section change, move on after this many beats… */
const HOLD_BEATS = 32;
/** …or this long, for music with no reliable pulse. */
const MAX_HOLD_S = 45;
/** How far the section must jump from its recent level to count as a new section. */
const SECTION_RISE_DB = 5;
const SECTION_FALL_DB = 7;
const SECTION_MEMORY_S = 6;
/** Loudness itself jumps on every kick, so "now" has to be smoothed past a single hit. */
const SECTION_NOW_S = 0.8;
/** The kick that ends a held breath, which is a drop by any measure. */
const BREATH_DROP = 0.95;
/**
 * It also earns a shorter hold. Phrases end just before drops, so the routine change on the
 * beat count often lands a moment earlier, and the full hold would swallow the real event.
 */
const BREATH_HOLD_S = 0.5;
/** A word on every drop stops being an event. */
const WORD_COOLDOWN_S = 45;
/** How far up a climb the word starts to form, so there's time to read it before it breaks. */
const WORD_BUILD_FROM = 0.3;

/**
 * Hands-free VJ mode: decides when the show should change. Big changes land where the music
 * itself changes (a drop, a breakdown), otherwise on a beat every 32 beats. The clock stops
 * during silence, so a gap between songs doesn't burn through looks.
 */
export class AutoDirector {
  /** True if the last change landed on a drop rather than a breakdown or the beat count. */
  drop = false;

  private sinceWord = WORD_COOLDOWN_S;
  private held = 0;
  private startBeat = 0;
  private lastBeat = 0;
  private recentDb: number | null = null;
  private nowDb: number | null = null;

  /** Returns true on the frame the show should change. */
  update(dt: number, audio: AudioFeatures): boolean {
    this.sinceWord += dt;
    if (audio.gate < 0.3) return false;
    this.held += dt;

    // Starts from what's first heard, or the opening itself would read as a huge jump.
    const recent = this.recentDb ?? audio.loudnessDb;
    const before = this.nowDb ?? audio.loudnessDb;
    const now = before + (audio.loudnessDb - before) * (1 - Math.exp(-dt / SECTION_NOW_S));
    const rise = now - recent;
    this.nowDb = now;
    this.recentDb = recent + rise * (1 - Math.exp(-dt / SECTION_MEMORY_S));

    const onBeat = audio.beatIndex !== this.lastBeat;
    this.lastBeat = audio.beatIndex;
    const breathDrop = audio.impact >= BREATH_DROP;
    if (this.held < (breathDrop ? BREATH_HOLD_S : MIN_HOLD_S)) return false;

    const locked = audio.tempoConfidence >= TEMPO_LOCKED;
    const drop = rise >= SECTION_RISE_DB || breathDrop;
    const newSection = drop || rise <= -SECTION_FALL_DB;
    const onOne = audio.barConfidence < BAR_LOCKED || audio.barBeat === 0;
    const beatsPassed = locked && onBeat && onOne && audio.beatIndex - this.startBeat >= HOLD_BEATS;
    if (!newSection && !beatsPassed && this.held < MAX_HOLD_S) return false;

    this.drop = drop;
    this.held = 0;
    this.startBeat = audio.beatIndex;
    return true;
  }

  /** A new track is a jump in loudness, but it isn't a section of the song. */
  newTrack(): void {
    this.recentDb = null;
    this.nowDb = null;
  }

  /** Whether to spell the word now, in the climb, for the drop to smash. */
  takeBuildWord(audio: AudioFeatures): boolean {
    if (audio.tension < WORD_BUILD_FROM || this.sinceWord < WORD_COOLDOWN_S) return false;
    this.sinceWord = 0;
    return true;
  }

  /** Whether the change just made should spell the word, which also starts its cooldown. */
  takeWord(): boolean {
    if (!this.drop || this.sinceWord < WORD_COOLDOWN_S) return false;
    this.sinceWord = 0;
    return true;
  }
}

export type ShowMood = 'heavy' | 'smooth' | 'ambient' | 'open';

/** Which looks suit each mood, and how strongly. Anything unlisted is left out. */
const SHOW_WEIGHTS: Record<
  ShowMood,
  {
    scenes: Partial<Record<SceneKey, number>>;
    palettes: Partial<Record<CuratedPaletteKey, number>>;
  }
> = {
  heavy: {
    scenes: { sphere: 3, morph: 3, cymatics: 2, nebula: 1, terrain: 1 },
    palettes: { solar: 3, cyber: 3, aurora: 1, gold: 1 },
  },
  smooth: {
    scenes: { nebula: 3, terrain: 3, sphere: 1 },
    palettes: { velvet: 3, gold: 3, aurora: 2, bio: 2 },
  },
  // A rigid grid would invent a pulse the music doesn't have.
  ambient: {
    scenes: { nebula: 1, cymatics: 1 },
    palettes: { aurora: 2, bio: 2, mercury: 2, velvet: 1 },
  },
  open: {
    scenes: { nebula: 1, sphere: 1, terrain: 1, morph: 1, cymatics: 1 },
    palettes: { aurora: 1, solar: 1, bio: 1, cyber: 1, mercury: 1, velvet: 1, gold: 1 },
  },
};

const VIBE_MOODS: Record<Vibe, ShowMood> = {
  Listening: 'open',
  'High energy': 'heavy',
  'Heavy groove': 'heavy',
  'Warm groove': 'smooth',
  'Melodic drift': 'smooth',
  'Deep calm': 'smooth',
};

/**
 * What kind of look suits the music. This reads the vibe rather than this frame's levels,
 * which swing with every hit: a change would otherwise depend on the frame it landed on, and
 * the show could disagree with the vibe on the dock.
 */
export function moodOf(audio: AudioFeatures, drop = false): ShowMood {
  if (audio.tempoConfidence < TEMPO_LOCKED) return 'ambient';
  if (drop) return 'heavy';
  return VIBE_MOODS[VIBES[audio.vibe] ?? VIBES[0]];
}

function pick<T extends string>(
  weights: Partial<Record<T, number>>,
  current: string,
  random: () => number,
): T | null {
  const options = (Object.entries(weights) as [T, number][]).filter(([key]) => key !== current);
  let left = random() * options.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [key, weight] of options) {
    left -= weight;
    if (left < 0) return key;
  }
  return options[options.length - 1]?.[0] ?? null;
}

/** The next look for this mood: always a different scene, never the same palette twice. */
export function nextShow(
  scene: SceneKey,
  palette: PaletteKey,
  mood: ShowMood = 'open',
  random: () => number = Math.random,
): { scene: SceneKey; palette: PaletteKey } {
  const weights = SHOW_WEIGHTS[mood];
  return {
    scene: pick<SceneKey>(weights.scenes, scene, random) ?? SCENES[0].key,
    palette: pick<CuratedPaletteKey>(weights.palettes, palette, random) ?? PALETTES[0].key,
  };
}
