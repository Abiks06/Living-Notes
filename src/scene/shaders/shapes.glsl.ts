/**
 * Morph targets as functions of the particle's index. Shape ids match `SHAPE` in
 * scenes.ts. Analytic shapes cost a few ALU ops; the wordmark and Lorenz attractor
 * are precomputed point clouds fetched from textures.
 */
export const shapesGlsl = /* glsl */ `
const float PI = 3.14159265359;
const float TAU = 6.28318530718;

uniform sampler2D uTextTargets;
uniform sampler2D uLorenzTargets;
uniform float uLorenzShift;
uniform vec3 uCameraDir;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;

float hash11(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

vec3 rotateY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

vec3 rotateX(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

/** Even coverage of the unit sphere: golden-angle spiral over the particle index. */
vec3 fibonacciSphere(float index, float count) {
  float y = 1.0 - 2.0 * (index + 0.5) / count;
  float r = sqrt(max(0.0, 1.0 - y * y));
  float phi = TAU * fract(index * 0.38196601125);
  return vec3(cos(phi) * r, y, sin(phi) * r);
}

vec3 torusKnotCurve(float t) {
  // (p, q) = (2, 3) trefoil-like knot.
  float r = 2.0 + cos(3.0 * t);
  return vec3(r * cos(2.0 * t), r * sin(2.0 * t), -sin(3.0 * t)) * 0.72;
}

vec3 torusKnot(float u, float seed) {
  float t = u * TAU;
  vec3 p = torusKnotCurve(t);
  vec3 tangent = normalize(torusKnotCurve(t + 0.01) - torusKnotCurve(t - 0.01));
  vec3 normal = normalize(cross(tangent, vec3(0.0, 0.0, 1.0)));
  vec3 binormal = cross(tangent, normal);
  float a = seed * TAU;
  float tube = 0.32 * sqrt(hash11(seed * 91.7));
  return p + (normal * cos(a) + binormal * sin(a)) * tube;
}

vec3 torusShape(float seed, float index) {
  float u = hash11(index * 0.731 + 3.1) * TAU;
  float v = seed * TAU;
  float tube = 0.55 * sqrt(hash11(index * 1.37 + 7.7));
  vec3 p = vec3((1.85 + tube * cos(v)) * cos(u), tube * sin(v), (1.85 + tube * cos(v)) * sin(u));
  return rotateX(p, 1.15);
}

vec3 helixShape(float u, float seed, float index) {
  float strand = mod(index, 2.0);
  float y = (u - 0.5) * 5.4;
  float angle = u * TAU * 2.2 + uSpin * 4.0;
  float radius = 1.15;
  vec3 a = vec3(cos(angle) * radius, y, sin(angle) * radius);
  vec3 b = vec3(cos(angle + PI) * radius, y, sin(angle + PI) * radius);
  vec3 jitter = (vec3(hash11(index), hash11(index + 1.3), hash11(index + 2.7)) - 0.5) * 0.14;
  // ~14% of particles form the rungs between the strands.
  if (seed < 0.14) {
    float rung = (floor(u * 30.0) + 0.5) / 30.0;
    float ry = (rung - 0.5) * 5.4;
    float ra = rung * TAU * 2.2 + uSpin * 4.0;
    vec3 ra3 = vec3(cos(ra) * radius, ry, sin(ra) * radius);
    vec3 rb3 = vec3(cos(ra + PI) * radius, ry, sin(ra + PI) * radius);
    return mix(ra3, rb3, hash11(index * 3.1)) + jitter * 0.5;
  }
  return (strand < 0.5 ? a : b) + jitter;
}

/** Moves each particle along the stored trajectory so the attractor visibly flows. */
vec3 lorenzShape(int index, int size) {
  int count = size * size;
  int shifted = (index + int(uLorenzShift)) % count;
  return texelFetch(uLorenzTargets, ivec2(shifted % size, shifted / size), 0).xyz;
}

vec3 shapeTarget(int shape, ivec2 texel, int size, float seed) {
  int index = texel.y * size + texel.x;
  float fi = float(index);
  float count = float(size * size);
  float u = (fi + 0.5) / count;
  if (shape == 0) return fibonacciSphere(fi, count) * 2.1;
  if (shape == 1) return torusKnot(u, seed);
  if (shape == 2) return helixShape(u, seed, fi);
  if (shape == 3) return torusShape(seed, fi);
  if (shape == 4) return lorenzShape(index, size);
  // The wordmark is billboarded so it stays readable while the camera orbits.
  vec3 t = texelFetch(uTextTargets, texel, 0).xyz;
  vec3 forward = cross(uCameraUp, uCameraRight);
  return uCameraRight * t.x + uCameraUp * t.y + forward * t.z;
}
`;
