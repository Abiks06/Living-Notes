import { noiseGlsl } from './noise.glsl';
import { pointerGlsl } from './pointer.glsl';
import { scenesGlsl } from './scenes.glsl';
import { shapesGlsl } from './shapes.glsl';

/*
 * GPUComputationRenderer injects `resolution` and one sampler per dependency
 * (`texturePosition`, `textureVelocity`). Position.w holds a stable per-particle seed;
 * velocity.w carries the scene's 0–1 "glow" through to the renderer for colouring.
 */

export const velocityShader = /* glsl */ `
uniform float uTime;
uniform float uDelta;
uniform float uKick;
uniform float uEnergy;
uniform float uIntensity;
uniform float uGate;
uniform float uCentroid;
uniform float uBeatPhase;
uniform float uTempoLock;
uniform float uVocal;
uniform float uInhale;
uniform float uImpact;
uniform float uTension;
uniform float uWorld;
uniform float uSustain;
uniform float uTwist;
uniform float uShatter;
uniform float uWordHold;
uniform float uHat;
uniform float uChroma[12];
uniform float uLiving;
uniform float uPresence;
uniform sampler2D uWave;
uniform float uWaveHead;
uniform float uWaveDelay;
uniform float uSpin;
uniform float uRing;
uniform float uRingStrength;
uniform float uMotion;
uniform float uCurl;
uniform float uTurbulence;
uniform float uSpring;
uniform int uSceneFrom;
uniform int uSceneTo;
uniform float uSceneMix;

const float MAX_SPEED = 7.0;
// How fast velocity steers toward the scene. With each scene's spring this is a second-order
// system: at 3 a 120 ms hit peaked 367 ms late and overshot 30%, at 7.5 it peaks at 233 ms,
// 27% higher, overshooting 12%. Pushing it further only damps the kicks, so it stops here.
const float RESPONSE = 7.5;
// Pushes are added to velocity and bled off at RESPONSE, so they carry 1/RESPONSE as far.
// This keeps the distance a kick, shockwave or release travels as it was designed.
const float PUSH = RESPONSE / 3.0;

${noiseGlsl}
${shapesGlsl}
${scenesGlsl}
${pointerGlsl}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  int size = int(resolution.x);
  vec4 posData = texelFetch(texturePosition, texel, 0);
  vec3 pos = posData.xyz;
  float seed = posData.w;
  vec3 vel = texelFetch(textureVelocity, texel, 0).xyz;

  // What's reaching this particle now: the further out, the older the moment it's feeling.
  bool flatScene = uSceneTo == 2 || uSceneTo == 4;
  // Light travels at full delay so you can watch it; motion barely does, or the surface,
  // which is what the eye follows, would land late.
  float fromCore = flatScene ? length(pos.xz) : length(pos);
  vec4 light = waveAt(fromCore);
  gWave = waveAt(fromCore * 0.2);

  // Evaluate the incoming scene, and the outgoing one only while a transition runs.
  float glow;
  vec3 desired = sceneVelocity(uSceneTo, pos, texel, size, seed, glow);
  vec3 kick = beatKick(uSceneTo, pos);
  if (uSceneMix < 1.0) {
    float glowFrom;
    vec3 desiredFrom = sceneVelocity(uSceneFrom, pos, texel, size, seed, glowFrom);
    desired = mix(desiredFrom, desired, uSceneMix);
    glow = mix(glowFrom, glow, uSceneMix);
    kick = mix(beatKick(uSceneFrom, pos), kick, uSceneMix);
  }

  // Each hit lights up as it passes, so you can watch it travel.
  float passing = light.z * light.z * 0.5 + light.y * light.y * 0.35;
  glow = clamp(glow + passing * uLiving * (1.0 - uWordHold), 0.0, 1.0);

  // Cap speed so scene changes read as flight, not teleportation.
  float speed = length(desired);
  if (speed > MAX_SPEED) desired *= MAX_SPEED / speed;

  // Steer toward the desired velocity; a held gravity well loosens the scene's grip.
  // Three species share the cloud: a light corona twitches on hats, and in Nebula a heavy
  // core drifts like liquid. A singing voice takes those same core particles for its ribbons.
  float corona = smoothstep(0.83, 0.87, seed);
  float heavy = uSceneTo == 0 ? (1.0 - smoothstep(0.16, 0.2, seed)) * (1.0 - uVocal) : 0.0;
  float response = RESPONSE * (1.0 + corona * 1.2) * mix(1.0, 0.4, heavy) * (1.0 - 0.96 * wellCapture(pos));
  vel = mix(vel, desired, 1.0 - exp(-uDelta * response));

  // Letters have to stay sharp enough to read, so the drums stand back from a held word.
  // Quiet parts of a song hold back, so the big ones have somewhere to go.
  float forces = PUSH * uMotion * uDelta * (1.0 - 0.9 * uWordHold) * mix(0.45, 1.0, uPresence) * (1.0 + uWorld * 0.35);
  vel += kick * gWave.x * gWave.x * (8.0 + seed * 14.0) * (1.0 + uImpact * 1.6) * forces;
  vel += backbeatTwist(uSceneTo, pos) * uTwist * 5.0 * forces;
  // The word breaks apart in every direction, including out of its own flat plane.
  vec3 burst = normalize(pos + vec3(0.0, 0.0, (seed - 0.5) * 4.0) + 1e-4);
  vel += burst * uShatter * uShatter * (14.0 + seed * 22.0) * PUSH * uMotion * uDelta;
  vec3 outward = normalize(kick + vec3(0.0, 1e-4, 0.0));
  // A drop throws everything outward at once, whatever the kick itself is doing.
  vel += outward * uImpact * uImpact * uLiving * (20.0 + seed * 34.0) * forces;
  // Near the top of a climb the whole structure starts to tremble under the pressure.
  vec3 shiver = vec3(hash11(seed * 91.7 + uTime * 61.0), hash11(seed * 37.3 + uTime * 47.0), hash11(seed * 53.1 + uTime * 29.0)) - 0.5;
  vel += shiver * uTension * uTension * 34.0 * forces;
  vel += outward * (hash11(seed * 53.1 + uTime) - 0.3) * uHat * corona * 26.0 * forces;
  vel += shockwave(uSceneTo, pos) * 30.0 * forces;
  vel = applyPointer(pos, vel, seed);

  gl_FragColor = vec4(vel, glow);
}
`;

export const positionShader = /* glsl */ `
uniform float uDelta;

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec4 pos = texelFetch(texturePosition, texel, 0);
  vec3 vel = texelFetch(textureVelocity, texel, 0).xyz;
  pos.xyz += vel * uDelta;
  gl_FragColor = pos;
}
`;
