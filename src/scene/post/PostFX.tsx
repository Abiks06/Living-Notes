import { useFrame, useThree } from '@react-three/fiber';
import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  ToneMapping,
  Vignette,
  wrapEffect,
} from '@react-three/postprocessing';
import { type BloomEffect, type ChromaticAberrationEffect, ToneMappingMode } from 'postprocessing';
import { useRef } from 'react';
import { HalfFloatType, Vector2, Vector3 } from 'three';
import { audioFeatures } from '../../audio/features';
import { useReducedMotion } from '../../lib/useMediaQuery';
import { useAppearance } from '../../settings/appearance';
import { liveLook } from '../../settings/bindings';
import { useSettings } from '../../settings/settingsStore';
import { useAppStore } from '../../state/appStore';
import { partMemory } from '../partLook';
import { sceneDirector } from '../SceneDirector';
import { AppearanceEffect } from './AppearanceEffect';
import { AtmosphereEffect, type Room } from './AtmosphereEffect';
import { type DropLight, ImpactEffect } from './ImpactEffect';
import { trailDamping } from './trailDamping';
import { TrailEffect } from './TrailEffect';

const Trail = wrapEffect(TrailEffect);
const Atmosphere = wrapEffect(AtmosphereEffect);
const Impact = wrapEffect(ImpactEffect);
const Look = wrapEffect(AppearanceEffect);
const BASE_ABERRATION = 0.0005;
/** Reused every frame, so the render loop stays allocation-free. */
const room: Room = {
  subBass: 0,
  section: 0,
  arousal: 0,
  inhale: 0,
  vocal: 0,
  sustain: 0,
  tension: 0,
  chroma: audioFeatures.chroma as Float32Array,
  chordCount: 0,
  living: true,
};
const dropLight: DropLight = { hit: 0, tension: 0, hang: 0, world: 0, calm: false, hue: 0 };
/** How much a drop lifts the bloom, in the living version and the original. */
const DROP_BLOOM = 2.4;
const ORIGINAL_DROP_BLOOM = 0.8;

/**
 * Trails → bloom → beat-driven chromatic aberration → vignette → tone mapping.
 * Strengths follow the scene director (eased through transitions) and the music.
 */
export function PostFX() {
  const camera = useThree((state) => state.camera);
  const reducedMotion = useReducedMotion();
  const fringe = useSettings((state) => state.aberration > 0);
  const motion = useRef({ previous: new Vector3(), damping: 0 });
  const trail = useRef<TrailEffect>(null);
  const atmosphere = useRef<AtmosphereEffect>(null);
  const impact = useRef<ImpactEffect>(null);
  const look = useRef<AppearanceEffect>(null);
  const bloom = useRef<BloomEffect>(null);
  const aberration = useRef<ChromaticAberrationEffect>(null);
  const offset = useRef(new Vector2(BASE_ABERRATION, BASE_ABERRATION));

  useFrame((_, delta) => {
    const dt = Math.min(Math.max(delta, 1e-3), 0.1);
    const m = motion.current;
    const speed =
      camera.position.distanceTo(m.previous) / dt / Math.max(camera.position.length(), 1);
    m.previous.copy(camera.position);
    m.damping = trailDamping(m.damping, speed, dt);

    const beat = audioFeatures.beat * (reducedMotion ? 0.25 : 1);
    const hit = audioFeatures.impact * audioFeatures.dropPower;
    const dropBloom = audioFeatures.living ? DROP_BLOOM : ORIGINAL_DROP_BLOOM;
    if (trail.current) {
      const base = sceneDirector.trail * liveLook.trails * (reducedMotion ? 0.6 : 1);
      trail.current.amount = base * (1 - m.damping);
    }
    if (bloom.current) {
      // A verse keeps its light back: the chorus can only feel big against something smaller.
      bloom.current.intensity =
        sceneDirector.bloom *
        liveLook.bloom *
        (0.45 + 0.55 * audioFeatures.presence) *
        (1 - 0.45 * audioFeatures.tension) *
        (1 + 0.3 * audioFeatures.world) *
        (0.6 +
          audioFeatures.intensity * 0.45 +
          audioFeatures.level * 0.3 +
          beat * 0.5 +
          hit * dropBloom * (reducedMotion ? 0.25 : 1));
    }
    if (aberration.current) {
      const pulse = reducedMotion ? 0 : audioFeatures.snare ** 2 * 0.004 + hit ** 2 * 0.014;
      const amount = (BASE_ABERRATION + pulse) * liveLook.aberration;
      aberration.current.offset.set(amount, amount * 0.6);
    }
  });

  useFrame((_, delta) => {
    room.subBass = audioFeatures.bands[0] ?? 0;
    room.section = audioFeatures.intensity * audioFeatures.gate;
    room.arousal = audioFeatures.arousal;
    room.inhale = audioFeatures.inhale;
    room.vocal = audioFeatures.vocal;
    room.sustain = audioFeatures.sustain;
    room.tension = audioFeatures.tension;
    room.chordCount = audioFeatures.harmonyCount;
    room.living = audioFeatures.living;
    const lounge = useAppStore.getState().lounge;
    atmosphere.current?.follow(liveLook.palette[1], liveLook.palette[2], room, lounge, delta);

    const living = audioFeatures.living;
    dropLight.hit = living ? audioFeatures.impact * audioFeatures.dropPower : 0;
    dropLight.tension = audioFeatures.tension;
    dropLight.hang = audioFeatures.hang;
    dropLight.world = audioFeatures.world;
    dropLight.calm = reducedMotion;
    dropLight.hue = partMemory.hue;
    impact.current?.follow(dropLight, liveLook.palette[2], delta);
    look.current?.follow(useAppearance.getState().appearance, Math.min(delta, 0.1));
  });

  return (
    <EffectComposer
      ref={(composer) => {
        if (import.meta.env.DEV) Object.assign(window, { __composer: composer });
      }}
      multisampling={0}
      frameBufferType={HalfFloatType}
    >
      <Trail ref={trail} />
      <Bloom
        ref={bloom}
        mipmapBlur
        intensity={1}
        luminanceThreshold={0.16}
        luminanceSmoothing={0.3}
        radius={0.72}
      />
      <Atmosphere ref={atmosphere} />
      <Impact ref={impact} />
      {/* Colour fringing needs a pass of its own over the whole screen, a quarter of the frame on
          integrated graphics, so it's only there for those who turn it up. */}
      {fringe ? (
        <ChromaticAberration
          ref={aberration}
          offset={offset.current}
          radialModulation
          modulationOffset={0.25}
        />
      ) : (
        <></>
      )}
      <Vignette offset={0.28} darkness={0.72} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Look ref={look} />
    </EffectComposer>
  );
}
