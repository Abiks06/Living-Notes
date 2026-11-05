import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  type DataTexture,
  FloatType,
  HalfFloatType,
  ShaderMaterial,
  Sphere,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { GPUComputationRenderer, type Variable } from 'three/addons/misc/GPUComputationRenderer.js';
import { BAND } from '../../audio/bands';
import type { AudioFeatures } from '../../audio/features';
import { TEMPO_LOCKED } from '../../audio/tempo';
import type { GpuTimer } from '../../perf/GpuTimer';
import type { LiveLook } from '../../settings/bindings';
import { chordOf, harmonicCentre, MAX_HUE_SHIFT, MAX_SATURATION_SHIFT } from '../harmony';
import type { PointerField } from '../interaction/pointerField';
import type { SceneDirector } from '../SceneDirector';
import { partMemory } from '../partLook';
import { sceneByKey } from '../scenes';
import { Spectrogram } from '../Spectrogram';
import { Wavefront } from '../Wavefront';
import { particleFragmentShader, particleVertexShader } from '../shaders/particles.glsl';
import { positionShader, velocityShader } from '../shaders/simulation.glsl';
import { createLorenzTargets, createTextTargets, fillTextTargets } from './shapeTextures';
import { REFERENCE_COUNT } from './tiers';
import { createRenderUniforms, createSimulationUniforms } from './uniforms';

export type SimulationPrecision = 'float' | 'half';

const MAX_STEP_S = 1 / 30;
/** Palette changes ease in over roughly this long. */
const PALETTE_EASE_S = 0.35;
const TEMPO_LOCK_EASE_S = 0.8;
/** Light takes about a fifth of a second from core to edge: long enough to see it travel. */
const WAVE_DELAY_S = 0.08;
const COIL_SPIN = 1.4;
/** A chord's centre sits well inside the circle, so this restores the full tint range. */
const CENTRE_GAIN = 1.6;
const CROWN_EASE_S = 0.12;
const CHORD_SHADOW = 0.3;
const MAJOR_SHADOW = new Color('#5a2408');
const MINOR_SHADOW = new Color('#0a1050');
/** The camera distance the word is sized for. */
const WORD_DISTANCE = 8.5;
const WORD_HOLD_EASE_S = 0.2;
/** Long enough that the tint follows chords, not the notes of a melody. */
const HARMONY_EASE_S = 0.9;
const HARMONY_RETURN_S = 3;
const CLEAR_PITCH = 0.25;
const BASE_POINT_SIZE = 20;
/** Radians per beat when a tempo is locked, or per second when it isn't. */
const SPIN_PER_BEAT = 0.06;
const FREE_SPIN = 0.12;
const RING_SPEED = 7;
const RING_FADE_S = 0.45;
const DROP_RING = 3;
/** How much of a jump in one frame counts as a drop landing. */
const NEW_DROP = 0.3;
/** How close to stopped the picture gets before a drop. Not quite: it still has to feel alive. */
const HANG_DEPTH = 0.96;
const CLIMB_COIL = 0.6;
const KICK_SNAP = 0.05;
const DROP_SNAP = 0.42;
/** The world heights notes span in the upright scenes, and the reach they span in flat ones. */
const NOTE_HEIGHT = 5;
const NOTE_REACH = 4.5;
const TERRAIN_ID = sceneByKey('terrain').id;
const CYMATICS_ID = sceneByKey('cymatics').id;
/**
 * Lorenz trajectory samples advanced per second. Targets move ~1.5 world units/s at this
 * rate, slow enough for particles (capped at 7 u/s) to ride the flow instead of lagging.
 */
const LORENZ_FLOW_RATE = 30;

export class GpuUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GpuUnsupportedError';
  }
}

/** Everything the simulation reads in one frame. Reused, never reallocated. */
export interface SimulationFrame {
  dt: number;
  time: number;
  pixelRatio: number;
  /** 1 normally, lower under prefers-reduced-motion. */
  motion: number;
  /** Drawing-buffer size, for measuring motion in pixels. */
  width: number;
  height: number;
  /** Camera distance to what it's looking at: the focal plane. */
  focalDistance: number;
  /** What the camera is looking at. */
  focus: Vector3;
  audio: AudioFeatures;
  director: SceneDirector;
  pointer: PointerField;
  look: LiveLook;
  /** Set while the tier benchmark times the simulation step. */
  stepTimer: GpuTimer | null;
}

function pickPrecision(renderer: WebGLRenderer): SimulationPrecision {
  if (renderer.extensions.has('EXT_color_buffer_float')) return 'float';
  if (renderer.extensions.has('EXT_color_buffer_half_float')) return 'half';
  throw new GpuUnsupportedError('This GPU cannot render to floating-point textures.');
}

/**
 * GPGPU particle system: positions and velocities live in ping-ponged float textures
 * (one texel per particle) and are integrated entirely on the GPU each frame.
 */
export class ParticleSimulation {
  readonly count: number;
  readonly precision: SimulationPrecision;
  readonly geometry: BufferGeometry;
  readonly material: ShaderMaterial;

  private readonly gpu: GPUComputationRenderer;
  private readonly positionVar: Variable;
  private readonly velocityVar: Variable;
  private readonly spectrogram = new Spectrogram();
  private readonly wave = new Wavefront();
  private readonly renderer: WebGLRenderer;
  private readonly textTargets: DataTexture;
  /** A second word for drops, kept apart so the visitor's Morph word is left alone. */
  private flashTargets: DataTexture | null = null;
  private flashText = '';
  private readonly lorenzTargets: DataTexture;
  private readonly simUniforms = createSimulationUniforms();
  private readonly renderUniforms = createRenderUniforms(BASE_POINT_SIZE);
  private hasRendered = false;
  /** The palette before harmony tints it: the uniforms hold the tinted copies. */
  private readonly baseLow = new Color();
  private readonly baseMid = new Color();
  private readonly baseHigh = new Color();
  private readonly centre = { x: 0, y: 0 };
  private readonly chord = { root: 0, colour: 0 };
  private readonly crown = new Float32Array(12);
  private chordColour = 0;
  private hueShift = 0;
  private saturationShift = 0;
  private spin = 0;
  private lastSnareCount = 0;
  private lastHit = 0;
  private word: string;

  constructor(renderer: WebGLRenderer, textureSize: number, word: string) {
    this.renderer = renderer;
    this.word = word;
    this.count = textureSize * textureSize;
    this.precision = pickPrecision(renderer);

    this.gpu = new GPUComputationRenderer(textureSize, textureSize, renderer);
    this.gpu.setDataType(this.precision === 'float' ? FloatType : HalfFloatType);

    const initialPositions = this.gpu.createTexture();
    const initialVelocities = this.gpu.createTexture();
    seedShell(initialPositions.image.data as Float32Array);

    this.velocityVar = this.gpu.addVariable('textureVelocity', velocityShader, initialVelocities);
    this.positionVar = this.gpu.addVariable('texturePosition', positionShader, initialPositions);
    this.gpu.setVariableDependencies(this.velocityVar, [this.positionVar, this.velocityVar]);
    this.gpu.setVariableDependencies(this.positionVar, [this.positionVar, this.velocityVar]);

    this.textTargets = createTextTargets(textureSize, word);
    this.lorenzTargets = createLorenzTargets(textureSize);
    const sim = this.simUniforms;
    sim.uSpectrogram.value = this.spectrogram.texture;
    sim.uTextTargets.value = this.textTargets;
    sim.uWave.value = this.wave.texture;
    sim.uLorenzTargets.value = this.lorenzTargets;
    Object.assign(this.velocityVar.material.uniforms, sim);
    Object.assign(this.positionVar.material.uniforms, { uDelta: sim.uDelta });

    const error = this.gpu.init();
    if (error) {
      this.disposeTextures();
      this.gpu.dispose();
      throw new GpuUnsupportedError(error);
    }

    const render = this.renderUniforms;
    render.uTextureSize.value = textureSize;
    // Total light ∝ count · alpha · size². Scale alpha and size² by 1/√k each so denser
    // tiers add detail at the same overall brightness instead of washing out to white.
    const density = this.count / REFERENCE_COUNT;
    render.uAlphaScale.value = 1 / Math.sqrt(density);
    render.uPointSize.value = BASE_POINT_SIZE / density ** 0.25;
    this.geometry = createAttributelessGeometry(this.count);
    this.material = new ShaderMaterial({
      uniforms: render,
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
  }

  /** Advances the simulation one frame. Allocation-free. */
  step(frame: SimulationFrame): void {
    const { audio, director, pointer, look } = frame;
    const bands = audio.bands;
    this.spectrogram.update(frame.dt, audio.spectrum);
    this.wave.update(frame.dt, audio);

    const sim = this.simUniforms;
    sim.uTime.value = frame.time;
    sim.uLiving.value = audio.living ? 1 : 0;
    sim.uPresence.value = audio.presence;
    sim.uWaveHead.value = this.wave.head;
    sim.uWaveDelay.value = audio.living ? WAVE_DELAY_S : 0;
    // Reduced motion gets none of the sudden moves: no hang, and nothing thrown at draw time.
    const full = frame.motion < 1 ? 0 : 1;
    const running = 1 - HANG_DEPTH * audio.hang * full;
    const hit = audio.impact * audio.dropPower;
    sim.uDelta.value = Math.min(frame.dt, MAX_STEP_S) * running;
    const locked = audio.tempoConfidence >= TEMPO_LOCKED;
    const pace = locked ? (audio.bpm / 60) * SPIN_PER_BEAT : FREE_SPIN;
    this.spin += frame.dt * running * pace * partMemory.spin;
    // Winding up: the structure coils faster through the breath before a drop.
    const coil = audio.inhale + audio.tension * CLIMB_COIL;
    this.spin += frame.dt * running * coil * frame.motion * COIL_SPIN;
    this.updateShockwave(frame);
    sim.uKick.value = audio.kick;
    sim.uEnergy.value = audio.energy;
    sim.uIntensity.value = audio.intensity;
    sim.uGate.value = audio.gate;
    sim.uCentroid.value = audio.centroid;
    sim.uBeatPhase.value = audio.groovePhase;
    // Eased, so the groove arrives and leaves rather than switching on mid-song.
    const lockEase = 1 - Math.exp(-frame.dt / TEMPO_LOCK_EASE_S);
    sim.uTempoLock.value += ((locked ? 1 : 0) - sim.uTempoLock.value) * lockEase;
    sim.uVocal.value = audio.vocal;
    sim.uInhale.value = audio.inhale * frame.motion;
    sim.uImpact.value = hit;
    sim.uTension.value = audio.tension * frame.motion;
    sim.uWorld.value = audio.world;
    sim.uSustain.value = audio.living ? audio.sustain * frame.motion : 0;
    // Backbeats twist one way and then the other, so the cloud rocks instead of winding up.
    sim.uTwist.value = audio.snare ** 2 * (audio.snareCount % 2 === 0 ? 1 : -1);
    this.updateWord(frame);
    sim.uHat.value = audio.hat;
    sim.uSpin.value = this.spin;
    sim.uModeA.value.fromArray(director.modeFrom);
    sim.uModeB.value.fromArray(director.modeTo);
    sim.uModeMix.value = director.modeMix;
    sim.uMotion.value = frame.motion;
    sim.uCurl.value = look.curl * partMemory.curl;
    sim.uTurbulence.value = look.turbulence * partMemory.turbulence;
    sim.uSpring.value = look.spring;
    sim.uBands.value = bands;
    sim.uSceneFrom.value = director.fromScene;
    sim.uSceneTo.value = director.toScene;
    sim.uSceneMix.value = director.sceneMix;
    sim.uShapeFrom.value = director.fromShape;
    sim.uShapeTo.value = director.toShape;
    sim.uShapeMix.value = director.shapeMix;
    sim.uSpectrogramHead.value = this.spectrogram.head;
    sim.uLorenzShift.value = (sim.uLorenzShift.value + frame.dt * LORENZ_FLOW_RATE) % this.count;
    sim.uPointer.value.copy(pointer.position);
    sim.uPointerVelocity.value.copy(pointer.velocity);
    sim.uPointerHover.value = pointer.hover;
    sim.uGravity.value = pointer.gravity;
    sim.uRelease.value = pointer.release;
    sim.uCameraDir.value.copy(pointer.cameraDir);
    sim.uCameraRight.value.copy(pointer.cameraRight);
    sim.uCameraUp.value.copy(pointer.cameraUp);

    frame.stepTimer?.begin();
    this.gpu.compute();
    frame.stepTimer?.end();

    const render = this.renderUniforms;
    render.uPositions.value = this.gpu.getCurrentRenderTarget(this.positionVar).texture;
    render.uVelocities.value = this.gpu.getCurrentRenderTarget(this.velocityVar).texture;
    render.uIntensity.value = audio.intensity;
    render.uGate.value = audio.gate;
    render.uCentroid.value = audio.centroid;
    // Hats re-roll the sparkle; the slow clock keeps it alive in music without them.
    render.uSparkleSeed.value = audio.hatCount + Math.floor(frame.time * 3) * 0.37;
    render.uFocalDistance.value = frame.focalDistance;
    // Focus tightens on the held breath, so the drop opens the whole picture back up.
    render.uAperture.value = look.dof * (1 + audio.inhale * frame.motion * 0.7);
    render.uResolution.value.set(frame.width, frame.height);
    render.uPixelRatio.value = frame.pixelRatio;
    render.uBass.value = bands[BAND.bass] ?? 0;
    render.uTreble.value = bands[BAND.treble] ?? 0;
    render.uHat.value = audio.hat;
    render.uInhale.value = audio.inhale * frame.motion;
    render.uVocal.value = audio.vocal;
    render.uPresence.value = audio.presence;
    render.uSpecies.value = 1 - sim.uWordHold.value;
    render.uBeat.value = audio.beat * frame.motion;
    const living = audio.living ? 1 : 0;
    const kickSnap = audio.kick ** 2 * KICK_SNAP * render.uSpecies.value;
    render.uSnap.value = (kickSnap + hit ** 2 * DROP_SNAP) * living * full;
    const isFlat = (id: number) => (id === TERRAIN_ID || id === CYMATICS_ID ? 1 : 0);
    const flatFrom = isFlat(director.fromScene);
    render.uFlat.value = flatFrom + (isFlat(director.toScene) - flatFrom) * director.sceneMix;
    render.uHit.value = hit * living * (full ? 1 : 0.4);
    const upright = (audio.notePitch - 0.5) * NOTE_HEIGHT;
    render.uNotePlace.value =
      upright + (audio.notePitch * NOTE_REACH - upright) * render.uFlat.value;
    render.uNoteGlow.value = audio.noteHit * living;
    render.uTension.value = audio.tension;
    render.uWorld.value = audio.world;
    render.uExposure.value = director.exposure;
    render.uPointScale.value = look.pointSize;
    // First frame snaps (a shared link opens in its palette); later changes ease.
    const ease = this.hasRendered ? 1 - Math.exp(-frame.dt / PALETTE_EASE_S) : 1;
    if (!this.hasRendered) {
      this.baseLow.copy(look.palette[0]);
      this.baseMid.copy(look.palette[1]);
      this.baseHigh.copy(look.palette[2]);
    }
    this.hasRendered = true;
    this.baseLow.lerp(look.palette[0], ease);
    this.baseMid.lerp(look.palette[1], ease);
    this.baseHigh.lerp(look.palette[2], ease);
    render.uColorD.value.lerp(look.palette[3], ease);
    this.updateHarmony(frame);
  }

  /** Chords tint the middle of the palette; without a clear pitch it drifts back home. */
  private updateHarmony(frame: SimulationFrame): void {
    const { audio, dt } = frame;
    const pitched = audio.gate > 0.3 && audio.pitchConfidence >= CLEAR_PITCH;
    const ease = 1 - Math.exp(-dt / (pitched ? HARMONY_EASE_S : HARMONY_RETURN_S));
    harmonicCentre(audio.chroma, this.centre);
    chordOf(audio.chroma, this.chord);
    const hue = pitched ? Math.max(-1, Math.min(1, this.centre.x * CENTRE_GAIN)) : 0;
    const saturation = pitched ? Math.max(-1, Math.min(1, this.centre.y * CENTRE_GAIN)) : 0;
    this.hueShift += (hue * MAX_HUE_SHIFT - this.hueShift) * ease;
    this.saturationShift += (saturation * MAX_SATURATION_SHIFT - this.saturationShift) * ease;
    this.chordColour += ((pitched ? this.chord.colour : 0) - this.chordColour) * ease;

    const crownEase = 1 - Math.exp(-dt / CROWN_EASE_S);
    for (let pitch = 0; pitch < 12; pitch++) {
      const energy = pitched ? (audio.chroma[pitch] ?? 0) ** 2 : 0;
      this.crown[pitch] =
        (this.crown[pitch] ?? 0) + (energy - (this.crown[pitch] ?? 0)) * crownEase;
    }
    this.simUniforms.uChroma.value = this.crown;

    const render = this.renderUniforms;
    // Shadows warm on major chords and cool on minor ones.
    const shade = this.chordColour > 0 ? MAJOR_SHADOW : MINOR_SHADOW;
    render.uColorA.value.copy(this.baseLow).lerp(shade, Math.abs(this.chordColour) * CHORD_SHADOW);
    render.uColorB.value.copy(this.baseMid).offsetHSL(this.hueShift, this.saturationShift, 0);
    render.uColorC.value.copy(this.baseHigh).offsetHSL(this.hueShift, this.saturationShift, 0);
  }

  /** A mid-register hit launches a ring that expands and fades. */
  private updateShockwave(frame: SimulationFrame): void {
    const { audio, motion } = frame;
    const sim = this.simUniforms;
    const newSnare = audio.snareCount !== this.lastSnareCount;
    this.lastSnareCount = audio.snareCount;
    if (newSnare && audio.snare > 0) {
      sim.uRing.value = 0.4;
      sim.uRingStrength.value = (0.5 + 0.5 * audio.intensity) * motion;
    }
    const hit = audio.impact * audio.dropPower;
    if (audio.living && hit - this.lastHit > NEW_DROP) {
      sim.uRing.value = 0.2;
      sim.uRingStrength.value = DROP_RING * hit * motion;
    }
    this.lastHit = hit;
    sim.uRing.value += frame.dt * RING_SPEED;
    sim.uRingStrength.value *= Math.exp(-frame.dt / RING_FADE_S);
  }

  /** Centres the word on what the camera is looking at, and sizes it to fit. */
  private updateWord(frame: SimulationFrame): void {
    const { director } = frame;
    const sim = this.simUniforms;
    const showing = director.wordFlash || director.shatter > 0;
    sim.uShatter.value = director.shatter;
    // Eased in, so the drop's own kick still lands while the word forms.
    const hold = director.wordFlash ? 1 : 0;
    sim.uWordHold.value +=
      (hold - sim.uWordHold.value) * (1 - Math.exp(-frame.dt / WORD_HOLD_EASE_S));
    sim.uWordFlash.value = showing ? 1 : 0;
    sim.uTextTargets.value = showing && this.flashTargets ? this.flashTargets : this.textTargets;
    if (!showing) return;
    sim.uWordCentre.value.copy(frame.focus);
    sim.uWordScale.value = frame.focalDistance / WORD_DISTANCE;
  }

  /**
   * Prepares the word a drop will spell. Rasterizing takes ~40 ms and the upload more, so it
   * happens when the track changes: on the drop itself it would be a visible stall.
   */
  setFlashWord(word: string): void {
    if (word === this.flashText) return;
    this.flashText = word;
    if (this.flashTargets) {
      fillTextTargets(this.flashTargets.image.data as Float32Array, word);
      this.flashTargets.needsUpdate = true;
    } else {
      this.flashTargets = createTextTargets(this.textTargets.image.width, word);
    }
    this.renderer.initTexture(this.flashTargets);
  }

  /** Re-rasterizes the wordmark target. Particles flow to the new word on their own. */
  setWord(word: string): void {
    if (word === this.word) return;
    this.word = word;
    fillTextTargets(this.textTargets.image.data as Float32Array, word);
    this.textTargets.needsUpdate = true;
  }

  dispose(): void {
    this.gpu.dispose();
    this.disposeTextures();
    this.geometry.dispose();
    this.material.dispose();
  }

  private disposeTextures(): void {
    this.spectrogram.dispose();
    this.wave.dispose();
    this.textTargets.dispose();
    this.flashTargets?.dispose();
    this.lorenzTargets.dispose();
  }
}

/** Random points in a thick spherical shell; w = per-particle seed in [0, 1). */
function seedShell(data: Float32Array): void {
  for (let i = 0; i < data.length; i += 4) {
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const radius = 1.6 + Math.random() * 1.4;
    const s = Math.sqrt(1 - u * u);
    data[i] = s * Math.cos(theta) * radius;
    data[i + 1] = u * radius;
    data[i + 2] = s * Math.sin(theta) * radius;
    data[i + 3] = Math.random();
  }
}

/**
 * A geometry with no vertex attributes at all: the vertex shader derives each particle's
 * texel from gl_VertexID, so the draw range alone sets how many points are drawn.
 */
function createAttributelessGeometry(count: number): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setDrawRange(0, count);
  // Never computed from attributes (there are none); generous bounds for safety.
  geometry.boundingSphere = new Sphere(new Vector3(), 50);
  return geometry;
}
