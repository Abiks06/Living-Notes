import { Color, type Texture, Vector2, Vector3 } from 'three';
import { BAND_COUNT } from '../../audio/bands';
import { SPECTROGRAM_ROWS } from '../Spectrogram';

/** Uniforms for the velocity pass. Objects are shared by reference with the material. */
export function createSimulationUniforms() {
  return {
    uTime: { value: 0 },
    uDelta: { value: 0 },
    uKick: { value: 0 },
    uEnergy: { value: 0 },
    uIntensity: { value: 1 },
    uGate: { value: 1 },
    uCentroid: { value: 0.4 },
    uBeatPhase: { value: 0 },
    uTempoLock: { value: 0 },
    uVocal: { value: 0 },
    uInhale: { value: 0 },
    uImpact: { value: 0 },
    uTension: { value: 0 },
    uWorld: { value: 0 },
    uSustain: { value: 0 },
    uTwist: { value: 0 },
    uLiving: { value: 1 },
    uPresence: { value: 1 },
    uWave: { value: null as Texture | null },
    uWaveHead: { value: 0 },
    /** Seconds a hit takes to travel one unit outward. */
    uWaveDelay: { value: 0 },
    uShatter: { value: 0 },
    uWordHold: { value: 0 },
    uWordFlash: { value: 0 },
    uWordCentre: { value: new Vector3() },
    uWordScale: { value: 1 },
    uHat: { value: 0 },
    /** Each pitch class's share of what's sounding, eased: the chord crown. */
    uChroma: { value: new Float32Array(12) as Float32Array },
    uSpin: { value: 0 },
    uRing: { value: 0 },
    uRingStrength: { value: 0 },
    uModeA: { value: new Vector2(1, 2) },
    uModeB: { value: new Vector2(1, 2) },
    uModeMix: { value: 1 },
    uMotion: { value: 1 },
    /** Studio multipliers (1 = each scene as designed). */
    uCurl: { value: 1 },
    uTurbulence: { value: 1 },
    uSpring: { value: 1 },
    /** Bound to `audioFeatures.bands` itself: the array updates without copying. */
    uBands: { value: new Float32Array(BAND_COUNT) as Float32Array },
    uSceneFrom: { value: 0 },
    uSceneTo: { value: 0 },
    uSceneMix: { value: 1 },
    uShapeFrom: { value: 0 },
    uShapeTo: { value: 0 },
    uShapeMix: { value: 1 },
    uSpectrogram: { value: null as Texture | null },
    uSpectrogramHead: { value: 0 },
    uSpectrogramRows: { value: SPECTROGRAM_ROWS },
    uTextTargets: { value: null as Texture | null },
    uLorenzTargets: { value: null as Texture | null },
    uLorenzShift: { value: 0 },
    uPointer: { value: new Vector3() },
    uPointerVelocity: { value: new Vector3() },
    uPointerHover: { value: 0 },
    uGravity: { value: 0 },
    uRelease: { value: 0 },
    uCameraDir: { value: new Vector3(0, 0, -1) },
    uCameraRight: { value: new Vector3(1, 0, 0) },
    uCameraUp: { value: new Vector3(0, 1, 0) },
  };
}

export function createRenderUniforms(pointSize: number) {
  return {
    uPositions: { value: null as Texture | null },
    uVelocities: { value: null as Texture | null },
    uTextureSize: { value: 0 },
    uPointSize: { value: pointSize },
    uIntensity: { value: 1 },
    uGate: { value: 1 },
    uCentroid: { value: 0.4 },
    uSparkleSeed: { value: 0 },
    uFocalDistance: { value: 8.5 },
    uAperture: { value: 1 },
    uResolution: { value: new Vector2(1, 1) },
    uPointScale: { value: 1 },
    uAlphaScale: { value: 1 },
    /** Per-shape brightness so compact formations don't saturate the additive blend. */
    uExposure: { value: 1 },
    uPixelRatio: { value: 1 },
    uBass: { value: 0 },
    uTreble: { value: 0 },
    uHat: { value: 0 },
    uBeat: { value: 0 },
    /** How far hits throw particles this frame, on top of the simulation. */
    uSnap: { value: 0 },
    /** 1 in the flat scenes, where hits go up rather than out. */
    uFlat: { value: 0 },
    uHit: { value: 0 },
    /** Where the latest note sits among the particles, and how much it's lighting them. */
    uNotePlace: { value: 0 },
    uNoteGlow: { value: 0 },
    uTension: { value: 0 },
    uWorld: { value: 0 },
    uInhale: { value: 0 },
    uPresence: { value: 1 },
    uVocal: { value: 0 },
    /** 1 normally, 0 while a word is held, so its letters keep one even stroke. */
    uSpecies: { value: 1 },
    uColorA: { value: new Color('#24166b') },
    uColorB: { value: new Color('#7b5cff') },
    uColorC: { value: new Color('#3fe0ff') },
    uColorD: { value: new Color('#ffe3f7') },
  };
}
