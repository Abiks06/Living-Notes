import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { type ComponentRef, useEffect, useRef } from 'react';
import { type PerspectiveCamera, Vector3 } from 'three';
import { BAND } from '../audio/bands';
import { audioFeatures } from '../audio/features';
import { TEMPO_LOCKED } from '../audio/tempo';
import { useReducedMotion } from '../lib/useMediaQuery';
import { useSettings } from '../settings/settingsStore';
import { useAppStore } from '../state/appStore';
import { partMemory } from './partLook';
import { sceneDirector } from './SceneDirector';
import { sceneByKey } from './scenes';
import { useLibraryRoom } from './useLibraryRoom';

const GLIDE_S = 1.8;
/** Auto-orbit waits this long after the visitor lets go before taking over again. */
const RESUME_AFTER_MS = 4000;
/** Below this aspect ratio (portrait phones) the camera backs off so scenes fit the width. */
const MIN_ASPECT = 0.8;
/** How far the look-at point moves with a locked tempo, in world units: a nod, not a sway. */
const NOD = 0.035;
const SWAY = 0.05;
const GROOVE_EASE_S = 1.2;
/** Verses sit in close and choruses pull back, as far as these multiples of the distance. */
const DOLLY_NEAR = 0.93;
const DOLLY_FAR = 1.07;
const DOLLY_OUT_S = 1.2;
const DOLLY_IN_S = 5;
/** Lens widths as fractions of the normal one: tight through a climb, thrown wide by a drop. */
const CLIMB_ZOOM = 0.1;
const DROP_ZOOM = 0.2;
const WORLD_ZOOM = 0.06;
const WORLD_EASE_S = 0.5;
/** How far a drop knocks the camera, in world units. */
const THUMP = 0.2;
const RATTLE = 0.07;
const RATTLE_SPEED = 53;

function smootherstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * Orbit/zoom camera with an audio-driven auto-orbit. On scene change it glides to that
 * scene's home pose; touching the controls cancels the glide and pauses auto-orbit.
 */
export function CameraRig() {
  const camera = useThree((state) => state.camera);
  const getState = useThree((state) => state.get);
  const scene = useSettings((state) => state.scene);
  const autoOrbit = useSettings((state) => state.autoOrbit);
  const captureFraming = useAppStore((state) => state.captureFraming);
  const appliedFraming = useRef(1);
  const reducedMotion = useReducedMotion();
  useLibraryRoom();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const groove = useRef({ amount: 0, applied: new Vector3(), next: new Vector3() });
  const dolly = useRef({ scale: 1, applied: 1 });
  const lens = useRef({ normal: 0, world: 0, applied: 0 });
  const glide = useRef({
    progress: 1,
    fromPosition: new Vector3(),
    toPosition: new Vector3(),
    fromTarget: new Vector3(),
    toTarget: new Vector3(),
    lastInteraction: -Infinity,
  });

  // Glide toward the scene's home, fitted to the viewport. Only on scene change: a window
  // resize must not yank the camera away from where the visitor put it.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const { width, height } = getState().size;
    const aspect = width / Math.max(1, height);
    const home = sceneByKey(scene).camera;
    const g = glide.current;
    g.fromPosition.copy(camera.position);
    g.fromTarget.copy(c.target);
    g.toTarget.fromArray(home.target);
    g.toPosition.fromArray(home.position).sub(g.toTarget);
    g.toPosition.multiplyScalar(Math.max(1, MIN_ASPECT / aspect)).add(g.toTarget);
    g.progress = 0;
  }, [scene, camera, getState]);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const onStart = () => {
      glide.current.progress = 1;
      glide.current.lastInteraction = performance.now();
      if (!useAppStore.getState().interacted) useAppStore.getState().setInteracted(true);
    };
    const onEnd = () => {
      glide.current.lastInteraction = performance.now();
    };
    c.addEventListener('start', onStart);
    c.addEventListener('end', onEnd);
    return () => {
      c.removeEventListener('start', onStart);
      c.removeEventListener('end', onEnd);
    };
  }, []);

  // Narrow clips: jump straight to the wider framing, so the recording opens on it.
  useEffect(() => {
    const c = controls.current;
    const scale = captureFraming / appliedFraming.current;
    if (!c || scale === 1) return;
    glide.current.progress = 1;
    camera.position.sub(c.target).multiplyScalar(scale).add(c.target);
    appliedFraming.current = captureFraming;
  }, [captureFraming, camera]);

  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    const g = glide.current;
    if (g.progress < 1) {
      g.progress = Math.min(1, g.progress + delta / GLIDE_S);
      const t = smootherstep(g.progress);
      camera.position.lerpVectors(g.fromPosition, g.toPosition, t);
      c.target.lerpVectors(g.fromTarget, g.toTarget, t);
    }

    const idle = performance.now() - g.lastInteraction > RESUME_AFTER_MS;
    // A word is only up for a moment, and it has to be read: everything holds still for it.
    const reading = sceneDirector.wordFlash;
    const hit = audioFeatures.living ? audioFeatures.impact * audioFeatures.dropPower : 0;
    c.autoRotate = autoOrbit && idle && c.enabled && !reading;

    // The camera grooves too, but never while the visitor is steering or it's travelling.
    const nod = groove.current;
    const zoom = dolly.current;
    if (g.progress < 1) {
      nod.applied.set(0, 0, 0);
      zoom.scale = 1;
      zoom.applied = 1;
    } else {
      const wanted =
        idle && !reading && !reducedMotion && audioFeatures.tempoConfidence >= TEMPO_LOCKED ? 1 : 0;
      nod.amount += (wanted - nod.amount) * (1 - Math.exp(-delta / GROOVE_EASE_S));
      // Felt beats: a half-time groove nods at the speed a head does, not at double time.
      const { groovePhase, feltBeat } = audioFeatures;
      const twoBeats = Math.PI * ((feltBeat % 2) + groovePhase);
      nod.next.set(
        Math.sin(twoBeats) * SWAY * nod.amount,
        -Math.exp(-groovePhase * 5.5) * NOD * nod.amount,
        0,
      );
      if (idle && !reducedMotion) {
        nod.next.y -= hit * hit * THUMP;
        nod.next.x += Math.sin(performance.now() * 0.001 * RATTLE_SPEED) * hit * hit * RATTLE;
      }
      c.target.sub(nod.applied).add(nod.next);
      nod.applied.copy(nod.next);

      // Scales whatever distance the visitor chose, so it never fights their zoom.
      if (idle && !reading && !reducedMotion && audioFeatures.live) {
        const wide = DOLLY_NEAR + (DOLLY_FAR - DOLLY_NEAR) * audioFeatures.intensity;
        const tau = wide > zoom.scale ? DOLLY_OUT_S : DOLLY_IN_S;
        zoom.scale += (wide - zoom.scale) * (1 - Math.exp(-delta / tau));
        camera.position
          .sub(c.target)
          .multiplyScalar(zoom.scale / zoom.applied)
          .add(c.target);
        zoom.applied = zoom.scale;
      }
    }
    const mid = audioFeatures.bands[BAND.mid] ?? 0;
    const pace = (1 - audioFeatures.hang) * (1 + audioFeatures.world * 0.6);
    c.autoRotateSpeed =
      (reducedMotion ? 0.12 : (0.35 + mid * 0.7) * pace) * (scene === 'terrain' ? 0.5 : 1);

    // Lens rather than position, so it can't fight the visitor's own orbit and zoom.
    const view = camera as PerspectiveCamera;
    const l = lens.current;
    if (l.normal === 0) l.normal = l.applied = view.fov;
    l.world += (audioFeatures.world - l.world) * (1 - Math.exp(-delta / WORLD_EASE_S));
    const width = reducedMotion
      ? 1
      : partMemory.lens -
        audioFeatures.tension * CLIMB_ZOOM +
        hit * hit * DROP_ZOOM +
        l.world * WORLD_ZOOM;
    const fov = l.normal * width;
    if (Math.abs(fov - l.applied) > 1e-3) {
      view.fov = l.applied = fov;
      view.updateProjectionMatrix();
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enablePan={false}
      minDistance={3.5}
      maxDistance={18}
      rotateSpeed={0.6}
      zoomSpeed={0.8}
    />
  );
}
