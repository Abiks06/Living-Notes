import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import { useAppStore } from '../../state/appStore';
import { pointerField } from './pointerField';

/** Press without moving this long to grab a gravity well instead of orbiting. */
const HOLD_MS = 220;
const HOLD_SLOP_PX = 6;
/** The wake fades out once the cursor rests this long. */
const IDLE_MS = 900;
const RELEASE_DECAY_S = 0.45;
const MAX_POINTER_SPEED = 20;

/** The subset of OrbitControls we touch (set by drei's `makeDefault`). */
interface Controls {
  enabled: boolean;
  target: Vector3;
}

/**
 * Turns pointer input into the world-space `pointerField`:
 * hover → wake, press-and-hold (or right-button / Shift-drag) → gravity well, release → burst.
 * A drag that moves before HOLD_MS stays an ordinary orbit.
 */
export function PointerInput() {
  const canvas = useThree((state) => state.gl.domElement);
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as Controls | null;
  const s = useRef({
    ndc: new Vector2(),
    inside: false,
    lastMove: 0,
    pressed: false,
    held: false,
    downX: 0,
    downY: 0,
    holdTimer: 0,
    hasPrevious: false,
    previous: new Vector3(),
    hit: new Vector3(),
    instant: new Vector3(),
    origin: new Vector3(),
    plane: new Plane(),
    raycaster: new Raycaster(),
  });

  useEffect(() => {
    const st = s.current;
    const markInteracted = () => {
      if (!useAppStore.getState().interacted) useAppStore.getState().setInteracted(true);
    };

    const updateNdc = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      st.ndc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      st.inside = true;
      st.lastMove = performance.now();
    };

    const cue = document.createElement('div');
    cue.className = 'well-cue';
    canvas.parentElement?.appendChild(cue);
    const placeCue = (event: PointerEvent) => {
      cue.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
    };

    const grabWell = () => {
      st.held = true;
      if (controls) controls.enabled = false;
      cue.dataset.state = 'active';
      canvas.style.cursor = 'grabbing';
    };

    const onMove = (event: PointerEvent) => {
      updateNdc(event);
      if (st.pressed) placeCue(event);
      if (st.pressed && !st.held) {
        const moved = Math.hypot(event.clientX - st.downX, event.clientY - st.downY);
        if (moved > HOLD_SLOP_PX) {
          window.clearTimeout(st.holdTimer);
          delete cue.dataset.state;
        }
      }
    };

    const onDown = (event: PointerEvent) => {
      // Right button or Shift-drag: the well is there at once and can be dragged around.
      const instant = event.button === 2 || (event.button === 0 && event.shiftKey);
      if (event.button !== 0 && !instant) return;
      updateNdc(event);
      placeCue(event);
      markInteracted();
      st.pressed = true;
      st.downX = event.clientX;
      st.downY = event.clientY;
      if (instant) {
        grabWell();
      } else {
        cue.dataset.state = 'charging';
        st.holdTimer = window.setTimeout(grabWell, HOLD_MS);
      }
    };

    const onUp = () => {
      window.clearTimeout(st.holdTimer);
      if (st.held) pointerField.release = 1;
      st.held = false;
      st.pressed = false;
      if (controls) controls.enabled = true;
      delete cue.dataset.state;
      canvas.style.cursor = '';
    };

    // The right button grabs the well, so the menu must not open over it.
    const onContextMenu = (event: Event) => event.preventDefault();

    const onLeave = (event: PointerEvent) => {
      // Touch "leaves" on every lift; only a mouse leaving the canvas ends hover.
      if (event.pointerType === 'mouse') st.inside = false;
    };

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.clearTimeout(st.holdTimer);
      cue.remove();
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      if (controls) controls.enabled = true;
    };
  }, [canvas, controls]);

  useFrame((_, delta) => {
    const st = s.current;
    const dt = Math.min(Math.max(delta, 1e-3), 0.1);
    const field = pointerField;
    camera.getWorldDirection(field.cameraDir);
    field.cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
    field.cameraUp.setFromMatrixColumn(camera.matrixWorld, 1);

    // Ray from the camera through the cursor onto a camera-facing plane at the orbit target.
    const target = controls?.target ?? st.origin;
    st.plane.setFromNormalAndCoplanarPoint(field.cameraDir, target);
    st.raycaster.setFromCamera(st.ndc, camera);
    const hit = st.raycaster.ray.intersectPlane(st.plane, st.hit);

    if (hit && st.inside) {
      if (st.hasPrevious) {
        st.instant.subVectors(hit, st.previous).divideScalar(dt);
        if (st.instant.length() > MAX_POINTER_SPEED) st.instant.setLength(MAX_POINTER_SPEED);
        field.velocity.lerp(st.instant, 1 - Math.exp(-dt * 18));
      }
      st.previous.copy(hit);
      st.hasPrevious = true;
      field.position.copy(hit);
    } else {
      st.hasPrevious = false;
      field.velocity.multiplyScalar(Math.exp(-dt * 6));
    }

    const recentlyMoved = st.inside && performance.now() - st.lastMove < IDLE_MS;
    const hoverTarget = recentlyMoved || st.held ? 1 : 0;
    field.hover += (hoverTarget - field.hover) * (1 - Math.exp(-dt * 6));
    const gravityTarget = st.held ? 1 : 0;
    field.gravity += (gravityTarget - field.gravity) * (1 - Math.exp(-dt * (st.held ? 5 : 14)));
    field.release = Math.max(0, field.release - dt / RELEASE_DECAY_S);
  });

  return null;
}
