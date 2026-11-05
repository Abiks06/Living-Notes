import type { AudioFeatures } from '../audio/features';
import { BAR_LOCKED } from '../audio/phrasing';
import { TEMPO_LOCKED } from '../audio/tempo';
import {
  CHLADNI_MODES,
  DEFAULT_SCENE,
  MORPH_SEQUENCE,
  SHAPE,
  type SceneDefinition,
  sceneByKey,
} from './scenes';

const SCENE_TRANSITION_S = 1.8;
/** A drop opens the next scene almost at once: nothing about it should feel like a fade. */
const DROP_TRANSITION_S = 0.7;
const MORPH_DURATION_S = 1.6;
/** With a tempo, shapes change on the beat this often, and morph across this many beats. */
const SHAPE_HOLD_BEATS = 16;
const MORPH_BEATS = 4;
/** Without one, a change needs a beat this strong or a harmonic shift… */
const STRONG_BEAT = 0.55;
const CLEAR_PITCH = 0.25;
/** …and holds each shape at least this long, so it never flickers through shapes. */
const MIN_SHAPE_HOLD_S = 5;
/** Quiet or beatless audio still advances the morph eventually. */
const MAX_SHAPE_HOLD_S = 10;
/** The word on a drop: quick in, long enough to read, then out with the next snare. */
const WORD_IN_S = 0.35;
const WORD_MIN_S = 1.6;
const WORD_MAX_S = 4;
const WORD_OUT_S = 0.8;
/** A word waiting for a drop gives up after this long, in case the song stops first. */
const WORD_WAIT_S = 14;
const SHATTER_DECAY_S = 0.45;
const MODE_HOLD_S = 1.2;
const MODE_MORPH_S = 0.9;

const MORPH_ID = sceneByKey('morph').id;
const CYMATICS_ID = sceneByKey('cymatics').id;
const FIRST_MODE = CHLADNI_MODES[0] ?? [1, 2];
/**
 * Additive blending makes brightness proportional to how tightly particles pack.
 * Compact shapes (the wordmark, the attractor) get less exposure so they don't clip.
 */
const SHAPE_EXPOSURE: Record<number, number> = {
  [SHAPE.sphere]: 1,
  [SHAPE.torusKnot]: 0.7,
  [SHAPE.helix]: 0.75,
  [SHAPE.torus]: 0.85,
  [SHAPE.lorenz]: 0.55,
  [SHAPE.text]: 0.32,
};
/** Nodal lines concentrate particles the way compact shapes do. */
const CYMATICS_EXPOSURE = 0.6;

function smootherstep(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * Decides *what* the particles are doing: which scene they steer toward, how far the
 * cross-fade between two scenes has progressed, and which Morph shape is active.
 * Pure state, no GPU: the simulation reads these numbers as uniforms.
 *
 * Scene changes never hard-cut. The shader evaluates both the outgoing and incoming
 * scene's steering and blends them, so particles fly from one formation to the next.
 */
export class SceneDirector {
  fromScene: number;
  toScene: number;
  /** 0 → fully `fromScene`, 1 → fully `toScene` (eased). */
  sceneMix = 1;

  // Morph opens on the knot, so no two scenes in a row open as a ball of particles.
  fromShape: number = SHAPE.torusKnot;
  toShape: number = SHAPE.torusKnot;
  /** Linear morph progress 0–1; the shader staggers it per particle. */
  shapeMix = 1;

  /** Chladni plate modes being cross-faded, and how far along. */
  modeFrom: readonly [number, number] = FIRST_MODE;
  modeTo: readonly [number, number] = FIRST_MODE;
  modeMix = 1;

  /** True while a word holds the screen after a drop. */
  wordFlash = false;
  /** 1 at the moment that word breaks apart, decaying. */
  shatter = 0;

  /** Post settings eased alongside the scene cross-fade. */
  trail: number;
  bloom: number;
  /** Particle brightness multiplier, eased across scene and shape changes. */
  exposure = 1;

  private sceneProgress = 1;
  private sceneDuration = SCENE_TRANSITION_S;
  private wordHeld = 0;
  private wordAwaitsDrop = false;
  private quickChange = false;
  private wordSnares = 0;
  private wordReturn: SceneDefinition | null = null;
  private wordShape: number = SHAPE.torusKnot;
  private pinnedShape: number | null = null;
  private shapeHold = 0;
  private morphDuration = MORPH_DURATION_S;
  private shapeStartBeat = 0;
  private lastBeatCount = 0;
  private lastBeatIndex = 0;
  private lastHarmonyCount = 0;
  private modeKey = 0;
  private modeHold = 0;
  private fromPost: { trail: number; bloom: number };
  private toPost: { trail: number; bloom: number };

  constructor(initial: SceneDefinition) {
    this.fromScene = initial.id;
    this.toScene = initial.id;
    this.fromPost = { ...initial.post };
    this.toPost = { ...initial.post };
    this.trail = initial.post.trail;
    this.bloom = initial.post.bloom;
  }

  /** Show a scene immediately, with no transition (initial load). */
  jumpTo(scene: SceneDefinition): void {
    this.wordFlash = false;
    this.fromScene = scene.id;
    this.toScene = scene.id;
    this.sceneProgress = 1;
    this.sceneMix = 1;
    this.fromPost.trail = this.toPost.trail = this.trail = scene.post.trail;
    this.fromPost.bloom = this.toPost.bloom = this.bloom = scene.post.bloom;
  }

  /**
   * Holds Morph on one shape, or returns to beat-driven cycling with null. With `immediate`
   * the shape is simply there, for a share link opening straight into it.
   */
  pinShape(shape: number | null, immediate = false): void {
    this.pinnedShape = shape;
    if (this.wordFlash) {
      if (shape !== null) this.wordShape = shape;
    } else if (shape === null) {
      this.shapeHold = 0;
    } else if (immediate) {
      this.fromShape = shape;
      this.toShape = shape;
      this.shapeMix = 1;
    } else if (shape !== this.toShape) {
      this.morphTo(shape);
    }
  }

  setScene(scene: SceneDefinition): void {
    // A scene chosen during the word is where it goes when it breaks apart.
    if (this.wordFlash) this.wordReturn = scene;
    else this.transitionTo(scene, this.quickChange ? DROP_TRANSITION_S : SCENE_TRANSITION_S);
    this.quickChange = false;
  }

  /** The next scene change is a drop's, so it should land rather than drift. */
  expectDropChange(): void {
    this.quickChange = true;
  }

  /**
   * Takes over the screen with the word, until the next snare after it's been read. With
   * `untilDrop` it's formed in the climb instead, and the drop itself smashes it.
   */
  flashWord(returnTo: SceneDefinition, snareCount: number, untilDrop = false): void {
    if (this.wordFlash) return;
    this.wordFlash = true;
    this.wordAwaitsDrop = untilDrop;
    this.wordHeld = 0;
    this.wordSnares = snareCount;
    this.wordReturn = returnTo;
    this.wordShape = this.toShape;
    this.fromShape = SHAPE.text;
    this.toShape = SHAPE.text;
    this.shapeMix = 1;
    this.transitionTo(sceneByKey('morph'), WORD_IN_S);
  }

  private updateWord(dt: number, audio: AudioFeatures): void {
    this.wordHeld += dt;
    const snare = audio.snareCount !== this.wordSnares;
    this.wordSnares = audio.snareCount;
    const read = this.wordHeld >= WORD_MIN_S && snare;
    if (this.wordAwaitsDrop) {
      if (audio.impact <= 0 && this.wordHeld < WORD_WAIT_S) return;
    } else if (!read && this.wordHeld < WORD_MAX_S) {
      return;
    }

    this.wordFlash = false;
    this.shatter = 1;
    this.fromShape = SHAPE.text;
    this.toShape = this.wordShape;
    this.shapeMix = 0;
    this.morphDuration = WORD_OUT_S;
    this.shapeHold = 0;
    if (this.wordReturn) this.transitionTo(this.wordReturn, WORD_OUT_S);
  }

  private transitionTo(scene: SceneDefinition, seconds: number): void {
    if (scene.id === this.toScene) return;
    this.sceneDuration = seconds;
    // Interrupting a transition: start the new one from wherever the eye currently is.
    this.fromScene = this.sceneMix < 0.5 ? this.fromScene : this.toScene;
    this.toScene = scene.id;
    this.sceneProgress = 0;
    this.fromPost.trail = this.trail;
    this.fromPost.bloom = this.bloom;
    this.toPost.trail = scene.post.trail;
    this.toPost.bloom = scene.post.bloom;
  }

  /** Allocation-free per-frame update. */
  update(dt: number, audio: AudioFeatures): void {
    if (this.sceneProgress < 1) {
      this.sceneProgress = Math.min(1, this.sceneProgress + dt / this.sceneDuration);
      this.sceneMix = smootherstep(this.sceneProgress);
      this.trail = this.fromPost.trail + (this.toPost.trail - this.fromPost.trail) * this.sceneMix;
      this.bloom = this.fromPost.bloom + (this.toPost.bloom - this.fromPost.bloom) * this.sceneMix;
      if (this.sceneProgress === 1) this.fromScene = this.toScene;
    }

    this.shatter = Math.max(0, this.shatter - dt / SHATTER_DECAY_S);
    if (this.wordFlash) this.updateWord(dt, audio);

    this.shapeMix = Math.min(1, this.shapeMix + dt / this.morphDuration);
    this.shapeHold += dt;
    this.updateExposure();
    this.updateMode(dt, audio);

    const newBeat = audio.beatCount !== this.lastBeatCount;
    const newHarmony = audio.harmonyCount !== this.lastHarmonyCount;
    const onBeat = audio.beatIndex !== this.lastBeatIndex;
    this.lastBeatCount = audio.beatCount;
    this.lastHarmonyCount = audio.harmonyCount;
    this.lastBeatIndex = audio.beatIndex;
    if (this.toScene !== MORPH_ID || this.pinnedShape !== null || this.wordFlash) return;
    // In a known song each part has its own shape, and the shape comes back when it does.
    if (audio.scored && audio.sectionPart >= 0) {
      const shape = MORPH_SEQUENCE[audio.sectionPart % MORPH_SEQUENCE.length] ?? this.toShape;
      if (shape !== this.toShape) {
        this.morphDuration = MORPH_DURATION_S;
        this.morphTo(shape);
      }
      return;
    }
    // Silence is a rest, not a cue. The hold restarts when the music does.
    if (audio.gate < 0.3 && audio.live) {
      this.shapeHold = 0;
      return;
    }

    if (audio.tempoConfidence >= TEMPO_LOCKED) {
      // Land on the grid of the song itself: on the 1, once the bar is known.
      const onOne = audio.barConfidence < BAR_LOCKED || audio.barBeat === 0;
      if (onBeat && onOne && audio.beatIndex - this.shapeStartBeat >= SHAPE_HOLD_BEATS) {
        this.shapeStartBeat = audio.beatIndex;
        this.morphDuration = Math.min(2.4, Math.max(1.2, (MORPH_BEATS * 60) / audio.bpm));
        this.advanceShape();
      }
      return;
    }

    this.shapeStartBeat = audio.beatIndex;
    const strongBeat = newBeat && audio.beatStrength >= STRONG_BEAT;
    const harmonicMove = newHarmony && audio.pitchConfidence >= CLEAR_PITCH;
    const cue = (strongBeat || harmonicMove) && this.shapeHold >= MIN_SHAPE_HOLD_S;
    if (cue || this.shapeHold >= MAX_SHAPE_HOLD_S) {
      this.morphDuration = MORPH_DURATION_S;
      this.advanceShape();
    }
  }

  /**
   * Cymatics plays the note: a held pitch picks the plate's mode. Unpitched sound falls back
   * to brightness, so drums and noise still change the figure.
   */
  private updateMode(dt: number, audio: AudioFeatures): void {
    this.modeMix = Math.min(1, this.modeMix + dt / MODE_MORPH_S);
    this.modeHold += dt;
    if (this.toScene !== CYMATICS_ID || audio.gate < 0.3 || this.modeHold < MODE_HOLD_S) return;

    const key =
      audio.pitchConfidence >= CLEAR_PITCH
        ? audio.pitchClass
        : Math.min(11, Math.floor(audio.centroid * 12));
    if (key === this.modeKey) return;
    this.modeKey = key;
    this.modeHold = 0;
    this.modeFrom = this.modeTo;
    this.modeTo = CHLADNI_MODES[key] ?? FIRST_MODE;
    this.modeMix = 0;
  }

  private updateExposure(): void {
    const from = SHAPE_EXPOSURE[this.fromShape] ?? 1;
    const to = SHAPE_EXPOSURE[this.toShape] ?? 1;
    const morph = from + (to - from) * smootherstep(this.shapeMix);
    const sceneExposure = (id: number) =>
      id === MORPH_ID ? morph : id === CYMATICS_ID ? CYMATICS_EXPOSURE : 1;
    const outgoing = sceneExposure(this.fromScene);
    this.exposure = outgoing + (sceneExposure(this.toScene) - outgoing) * this.sceneMix;
  }

  private advanceShape(): void {
    const next = (MORPH_SEQUENCE.indexOf(this.toShape) + 1) % MORPH_SEQUENCE.length;
    this.morphTo(MORPH_SEQUENCE[next] ?? 0);
  }

  private morphTo(shape: number): void {
    // If a morph is still in flight, continue from the shape it was heading to.
    this.fromShape = this.shapeMix < 0.5 ? this.fromShape : this.toShape;
    this.toShape = shape;
    this.shapeMix = 0;
    this.shapeHold = 0;
  }
}

/** App-wide director: the simulation, camera rig and post-processing all read it. */
export const sceneDirector = new SceneDirector(sceneByKey(DEFAULT_SCENE));

if (import.meta.env.DEV) Object.assign(window, { __director: sceneDirector });
