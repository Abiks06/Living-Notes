/**
 * Screen-space trails assume the picture stays still under the particles. When the camera
 * itself moves, the whole cloud would smear, so trails fade out during fast camera motion.
 *
 * Speed is camera travel divided by distance to the subject: about rad/s while orbiting,
 * and relative zoom rate while dollying. Auto-orbit stays under 0.12; a drag is 1 or more.
 */
const CALM_SPEED = 0.2;
const FAST_SPEED = 0.7;
/** Quick to engage so the first frames of a drag don't smear; slow to return, so no pop. */
const ENGAGE_S = 0.05;
const RELEASE_S = 0.45;

/** Returns the next damping value: 0 = full trails, 1 = no trails. */
export function trailDamping(current: number, speed: number, dt: number): number {
  const x = Math.min(1, Math.max(0, (speed - CALM_SPEED) / (FAST_SPEED - CALM_SPEED)));
  const target = x * x * (3 - 2 * x);
  const tau = target > current ? ENGAGE_S : RELEASE_S;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}
