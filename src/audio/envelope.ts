/**
 * One-pole follower with separate attack and release time constants (seconds).
 * Frame-rate independent: the same tau feels identical at 60 Hz and 144 Hz.
 */
export function follow(
  current: number,
  target: number,
  dt: number,
  attack: number,
  release: number,
): number {
  const tau = target > current ? attack : release;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
