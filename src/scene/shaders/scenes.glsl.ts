/**
 * Each scene returns a *desired velocity* for a particle (plus a 0–1 "glow" used for
 * colour). The integrator steers toward it, so blending two scenes during a transition
 * is just a mix of two vectors. Scene ids match `SCENES` in scenes.ts.
 *
 * Bands (uBands): 0 sub, 1 bass, 2 low-mid, 3 mid, 4 high-mid, 5 treble.
 */
export const scenesGlsl = /* glsl */ `
uniform float uBands[6];
uniform sampler2D uSpectrogram;
uniform float uSpectrogramHead;
uniform float uSpectrogramRows;
uniform int uShapeFrom;
uniform int uShapeTo;
uniform float uShapeMix;
uniform vec2 uModeA;
uniform vec2 uModeB;
uniform float uModeMix;
uniform float uWordFlash;
uniform vec3 uWordCentre;
uniform float uWordScale;

// This frame's slice of the travelling wave for the current particle: push, snare, kick, sub.
vec4 gWave;

vec4 waveAt(float dist) {
  float row = uWaveHead - min(dist * uWaveDelay * 60.0, 60.0);
  float whole = floor(row);
  vec4 a = texelFetch(uWave, ivec2(int(mod(whole, 64.0)), 0), 0);
  vec4 b = texelFetch(uWave, ivec2(int(mod(whole + 1.0, 64.0)), 0), 0);
  return mix(a, b, row - whole);
}

// The felt pulse: a snap on the beat itself, then a soft rebound through the rest of it.
// Zero without a locked tempo, so free-time music is never given a groove it doesn't have.
float groove() {
  float downbeat = exp(-uBeatPhase * 5.5);
  float rebound = sin(PI * uBeatPhase);
  return uTempoLock * uMotion * mix(rebound * rebound * 0.35, downbeat, 0.65);
}

// Through the climb and the held breath before a drop, everything draws in.
float inhaled(float amount) {
  return max(0.12, 1.0 - uInhale * amount - uTension * amount * 1.2);
}

// How much of the note at this angle is sounding. Twelve notes run around the equator.
float chromaAt(float around) {
  float place = fract(around / TAU) * 12.0;
  int note = int(floor(place));
  return mix(uChroma[note], uChroma[(note + 1) % 12], smoothstep(0.0, 1.0, fract(place)));
}

float bandAt(float position) {
  float p = clamp(position, 0.0, 5.0);
  int i = int(floor(p));
  float f = smoothstep(0.0, 1.0, fract(p));
  return mix(uBands[i], uBands[min(i + 1, 5)], f);
}

// 0 · Nebula: curl-noise drift through a lumpy, breathing cloud.
vec3 nebula(vec3 pos, float seed, out float glow) {
  float r = length(pos);
  vec3 dir = pos / max(r, 1e-4);

  // Bright sounds tighten the swirls; dark ones open them out.
  float frequency = (0.42 + uBands[3] * 0.22 + (uCentroid - 0.4) * 0.45) * uCurl;
  vec3 flow = curlNoise(pos * frequency + vec3(0.0, uTime * 0.06, uTime * 0.04));
  // Mostly tangential, so particles stream along the surface and draw out filaments.
  flow -= dir * dot(flow, dir) * 0.85;
  vec3 v = flow * (0.2 + uEnergy * 0.6 * uMotion) * uTurbulence;
  v += cross(vec3(0.0, 1.0, 0.0), pos) * (0.08 + uBands[3] * 0.25 * uMotion + uInhale * 0.7);

  // A voice or lead lifts the whole cloud, like warm air.
  v.y += uVocal * 0.35 * uMotion;

  // Slow noise on the radius makes a cloud rather than a ball; section loudness sets its
  // size, and a locked tempo makes it breathe on the beat.
  vec3 unused;
  float lump = snoise(dir * 1.3 + vec3(uTime * 0.03, 0.0, -uTime * 0.02), unused);
  float breath = groove() * 0.24;
  float home = ((1.5 + 0.6 * uIntensity) * (1.0 + 0.34 * lump) + breath) * inhaled(0.28);
  home += (seed - 0.5) * 0.9 + gWave.w * 0.45 * uMotion + uSustain * 0.4;
  // A heavy heart that throbs with the sub-bass, and a loose halo of stardust around it all.
  float heart = 1.0 - smoothstep(0.16, 0.2, seed);
  home = mix(home, home * 0.55 + uBands[0] * 0.9 * uMotion, heart);
  home *= 1.0 + smoothstep(0.83, 0.87, seed) * 0.18;
  v -= dir * (r - home) * 1.6 * uSpring;
  glow = clamp(length(v) * 0.4 + uVocal * 0.3, 0.0, 1.0);

  // The melody's own layer: a fifth of the particles leave the cloud to rise through its
  // centre as three ribbons, for as long as something is singing, drums or no drums.
  if (seed < 0.2 && uVocal > 0.02 && uLiving < 0.5) {
    float strand = floor(hash11(seed * 71.3) * 3.0);
    float along = fract(hash11(seed * 13.7) + uTime * 0.07);
    float angle = along * TAU * 1.4 + uTime * 0.5 + strand * TAU / 3.0;
    float reach = 0.35 + 0.55 * sin(along * PI);
    vec3 ribbon = vec3(cos(angle) * reach, (along - 0.5) * 4.4, sin(angle) * reach);
    // Released near both ends, so the wrap back to the bottom is never seen as a streak.
    float pull = smoothstep(0.05, 0.35, uVocal) * smoothstep(0.0, 0.1, along) * smoothstep(1.0, 0.9, along);
    v = mix(v, (ribbon - pos) * 3.5, pull);
    glow = max(glow, pull * 0.85);
  }
  return v;
}

// 1 · Sphere Pulse: sub-bass at the south pole up to treble at the north.
vec3 spherePulse(vec3 pos, ivec2 texel, int size, out float glow) {
  float count = float(size * size);
  vec3 unit = fibonacciSphere(float(texel.y * size + texel.x), count);
  float band = bandAt((unit.y * 0.5 + 0.5) * 5.0);
  float ripple = sin(unit.x * 9.0 + uTime * 3.0) * sin(unit.z * 9.0 - uTime * 2.2) * uBands[5];
  float base = (1.45 + 0.4 * uIntensity + groove() * 0.2 + uSustain * 0.25) * inhaled(0.25);
  // The chord crown: every note sounding pushes out its own lobe around the equator, so the
  // sphere becomes a living chord diagram.
  float around = atan(unit.z, unit.x);
  float crown = chromaAt(around) * sqrt(max(0.0, 1.0 - unit.y * unit.y)) * max(uVocal, uSustain) * 0.9 * uMotion;
  float radius = base + band * 1.15 * uMotion + gWave.x * 0.22 * uMotion + crown + ripple * 0.09 * uTurbulence;
  vec3 target = rotateY(unit * radius, uSpin);
  glow = band;
  return (target - pos) * 6.0 * uSpring;
}

// 2 · Terrain: a particle grid whose height is the scrolling spectrogram.
vec3 terrain(vec3 pos, ivec2 texel, int size, float seed, out float glow) {
  vec2 uv = (vec2(texel) + 0.5) / float(size);
  vec2 jitter = (vec2(seed, hash11(seed * 47.3)) - 0.5) / float(size);
  vec2 grid = uv + jitter;
  // Bass in the centre valley, highs toward both edges; newest rows nearest the camera.
  float frequency = abs(grid.x - 0.5) * 2.0;
  float age = 1.0 - grid.y;
  float row = uSpectrogramHead - (1.5 + age * (uSpectrogramRows - 3.0)) / uSpectrogramRows;
  float level = texture2D(uSpectrogram, vec2(0.01 + frequency * 0.98, row)).r;
  float height = pow(level, 1.7) * 2.7 * mix(0.5, 1.0, uMotion) * uGate * (1.0 + groove() * 0.2) * inhaled(0.45);
  // Chords roll through underneath the sharp frequency ridges.
  height += (0.5 + 0.5 * sin(grid.y * TAU * 1.5 - uTime * 0.9)) * max(uVocal, uSustain) * 0.5 * uMotion * uGate;
  vec3 target = vec3((grid.x - 0.5) * 9.0, -1.7 + height, (grid.y - 0.5) * 9.0);
  glow = clamp(level * 1.15, 0.0, 1.0);
  // Peaks shed embers. A peak scrolls past in a moment, so what makes an ember is how slowly it
  // falls afterwards: the spring alone would snap it straight back down.
  float light = step(0.9, seed) * uMotion;
  float ember = light * smoothstep(0.45, 0.7, level);
  float above = clamp((pos.y - target.y) / 2.6, 0.0, 1.0);
  vec3 rise = vec3(sin(seed * 40.0 + uTime * 1.3) * 0.5, 3.2 * (1.0 - above), cos(seed * 31.0 + uTime) * 0.5);
  vec3 settle = (target - pos) * 7.0 * uSpring;
  // Falling faster the higher it gets is also the ceiling: kicks and hats push upward here,
  // and at a fixed slow fall they'd pump embers out of the scene for good.
  if (light > 0.0) settle.y = max(settle.y, -0.55 - above * above * 9.0);
  glow = max(glow, max(ember, light * above));
  return mix(settle, rise, ember);
}

// 3 · Morph: shapes cross-fade on strong beats, staggered per particle.
vec3 morph(vec3 pos, ivec2 texel, int size, float seed, out float glow) {
  float t = smoothstep(0.0, 1.0, clamp(uShapeMix * 1.6 - seed * 0.6, 0.0, 1.0));
  // Evaluate only what this particle needs: not yet launched, landed, or in flight.
  vec3 target;
  if (t <= 0.0) {
    target = shapeTarget(uShapeFrom, texel, size, seed);
  } else if (t >= 1.0) {
    target = shapeTarget(uShapeTo, texel, size, seed);
  } else {
    target = mix(
      shapeTarget(uShapeFrom, texel, size, seed),
      shapeTarget(uShapeTo, texel, size, seed),
      t
    );
  }

  // A word has to be read, so it's placed before the scaling below: letters that pulse with
  // the music smear into each other. It already faces the camera (see shapes.glsl).
  if (uWordFlash > 0.5) {
    target = uWordCentre + target * uWordScale;
    glow = 0.75;
    return (target - pos) * 9.0;
  }

  // Mid-flight, particles swirl instead of travelling in straight lines.
  float flight = sin(t * PI);
  if (flight > 0.01) target += curlNoise(target * 0.6 * uCurl + uTime * 0.1) * 0.35 * flight * uTurbulence;
  target *= (0.9 + 0.14 * uIntensity + uSustain * 0.08) * (1.0 + uEnergy * 0.12 * uMotion + groove() * 0.05) * inhaled(0.2);
  // A landed word lives: a ripple runs through it with the voice, and bass pushes it in depth.
  if (uShapeTo == 5 && t >= 1.0) {
    target += uCameraUp * sin(dot(target, uCameraRight) * 1.6 - uTime * 3.5) * uVocal * 0.14 * uMotion;
    vec3 forward = cross(uCameraUp, uCameraRight);
    target += forward * dot(target, forward) * (uBands[0] * 1.8 + groove() * 0.5);
  }
  glow = clamp(0.3 + 0.7 * max(flight, uBands[2]), 0.0, 1.0);
  return (target - pos) * 5.0 * uSpring;
}

// Chladni figure of a square plate, and its gradient, for one mode.
float chladni(vec2 p, vec2 mode, out vec2 gradient) {
  float a = mode.x * PI;
  float b = mode.y * PI;
  float cax = cos(a * p.x), sax = sin(a * p.x);
  float cbx = cos(b * p.x), sbx = sin(b * p.x);
  float cay = cos(a * p.y), say = sin(a * p.y);
  float cby = cos(b * p.y), sby = sin(b * p.y);
  gradient = vec2(-a * sax * cby + b * sbx * cay, -b * cax * sby + a * cbx * say);
  return cax * cby - cbx * cay;
}

// 4 · Cymatics: the real physics of acoustic resonance. A vibrating plate has lines that
// stay still (nodes). Sand is thrown off everything else and comes to rest on them, so
// particles slide down f² and get kicked in proportion to how hard their spot is shaking.
vec3 cymatics(vec3 pos, float seed, out float glow) {
  const float PLATE = 3.7;
  vec2 p = pos.xz / PLATE;
  vec2 gradA;
  vec2 gradB;
  float fA = chladni(p, uModeA, gradA);
  float fB = chladni(p, uModeB, gradB);
  float f = mix(fA, fB, uModeMix);
  vec2 gradient = mix(gradA, gradB, uModeMix);

  vec2 slide = -f * gradient * 0.42;
  float slideSpeed = length(slide);
  if (slideSpeed > 3.2) slide *= 3.2 / slideSpeed;

  float tick = floor(uTime * 24.0);
  vec2 shake = vec2(hash11(seed * 91.7 + tick), hash11(seed * 37.3 + tick * 1.7)) - 0.5;
  // 0.4 offsets the integrator passing more of this 24 Hz noise than it used to.
  slide += shake * abs(f) * (0.8 + uEnergy * 7.0 * uMotion) * 0.4 * (1.0 + groove() * 0.9);

  // Stay on the plate.
  vec2 inside = clamp(p, -1.0, 1.0);
  slide += (inside - p) * PLATE * 7.0;

  // The plate itself flexes with the sound.
  float height = -1.3 + f * (0.06 + uEnergy * 0.55 * uMotion + groove() * 0.14) * inhaled(0.7);
  glow = clamp((1.0 - smoothstep(0.0, 0.45, abs(f))) * (0.35 + uEnergy) + gWave.x * 0.2, 0.0, 1.0);
  return vec3(slide.x, (height - pos.y) * 7.0 * uSpring, slide.y);
}

vec3 sceneVelocity(int scene, vec3 pos, ivec2 texel, int size, float seed, out float glow) {
  if (scene == 0) return nebula(pos, seed, glow);
  if (scene == 1) return spherePulse(pos, texel, size, glow);
  if (scene == 2) return terrain(pos, texel, size, seed, glow);
  if (scene == 3) return morph(pos, texel, size, seed, glow);
  return cymatics(pos, seed, glow);
}

/** Direction and strength of the outward push a low hit gives in each scene. */
vec3 beatKick(int scene, vec3 pos) {
  if (scene == 2 || scene == 4) return vec3(0.0, 0.55, 0.0);
  float strength = scene == 1 ? 0.45 : scene == 3 ? 0.7 : 1.0;
  return normalize(pos + 1e-4) * strength;
}

/** A snare's sideways twist around the vertical axis. Flat scenes keep their grid. */
vec3 backbeatTwist(int scene, vec3 pos) {
  if (scene == 2 || scene == 4) return vec3(0.0);
  return vec3(-pos.z, 0.0, pos.x);
}

/** A mid-register hit sends a ring outward: around the cloud, or across a flat scene. */
vec3 shockwave(int scene, vec3 pos) {
  bool flatScene = scene == 2 || scene == 4;
  float radius = flatScene ? length(pos.xz) : length(pos);
  float front = (radius - uRing) / 0.42;
  float band = exp(-front * front);
  vec3 away = flatScene ? vec3(0.0, 1.0, 0.0) : normalize(pos + 1e-4);
  return away * band * uRingStrength;
}
`;
