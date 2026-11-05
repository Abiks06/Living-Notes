/**
 * Pointer force field, in world space.
 * - Wake: particles near a moving cursor are dragged along with it.
 * - Gravity well: holding the pointer pulls particles in and spins them around it.
 * - Release: letting go blows the captured particles back out.
 */
export const pointerGlsl = /* glsl */ `
uniform vec3 uPointer;
uniform vec3 uPointerVelocity;
uniform float uPointerHover;
uniform float uGravity;
uniform float uRelease;

/** How strongly the well currently owns this particle (0–1); weakens scene steering. */
float wellCapture(vec3 pos) {
  vec3 d = pos - uPointer;
  return uGravity * exp(-dot(d, d) / 6.0);
}

vec3 applyPointer(vec3 pos, vec3 vel, float seed) {
  vec3 d = pos - uPointer;
  float dist2 = dot(d, d);
  float dist = sqrt(dist2) + 1e-4;
  vec3 n = d / dist;

  float wake = exp(-dist2 / 0.55) * uPointerHover;
  vel = mix(vel, uPointerVelocity, wake * (1.0 - exp(-uDelta * 9.0)));
  vel += n * wake * min(length(uPointerVelocity), 8.0) * 0.9 * uDelta;

  if (uGravity > 0.001) {
    // Scene steering fights the pull, harder the less a particle is captured, so its reach is
    // kept by scaling the pull with how much steering this particle still has.
    float capture = wellCapture(pos);
    float reach = PUSH * (1.0 - 0.96 * capture) / (1.0 - 0.9 * capture);
    float pull = uGravity * 16.0 * reach / (1.0 + dist2 * 0.3);
    vel += (-n + cross(n, uCameraDir) * 0.7) * pull * uDelta;
  }
  if (uRelease > 0.001) {
    vel += n * uRelease * (28.0 + seed * 22.0) * PUSH * exp(-dist * 0.5) * uDelta;
  }
  return vel;
}
`;
