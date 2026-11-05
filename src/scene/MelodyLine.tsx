import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  BufferGeometry,
  Color,
  CustomBlending,
  DataTexture,
  DoubleSide,
  FloatType,
  NearestFilter,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RGBAFormat,
  ShaderMaterial,
  Sphere,
  Vector3,
} from 'three';
import { audioFeatures, LINE_AHEAD_S, LINE_PAST_S, LINE_ROWS } from '../audio/features';
import { liveLook } from '../settings/bindings';
import { sceneDirector } from './SceneDirector';

const SEGMENTS = LINE_ROWS - 1;
const HEAD = LINE_PAST_S / (LINE_PAST_S + LINE_AHEAD_S);
const SECONDS_PER_ROW = (LINE_PAST_S + LINE_AHEAD_S) / SEGMENTS;
const FADE_S = 0.5;
/** How quickly a live line glides to a new note. Known songs don't need easing. */
const GLIDE = 0.3;
/** Widescreen framing; narrower screens compress time rather than lose the line off the edge. */
const FULL_ASPECT = 1.6;

const vertexShader = /* glsl */ `
uniform sampler2D uLine;
uniform float uFade;
uniform float uWidth;
uniform vec3 uFocus;

varying float vAcross;
varying float vLight;
varying float vHeat;
varying float vAhead;
varying float vAlong;

const float ROWS = ${LINE_ROWS}.0;
const float SEGMENTS = ${SEGMENTS}.0;
const float HEAD = ${HEAD};

vec2 heard(float u) {
  float row = clamp(u, 0.0, 1.0) * SEGMENTS;
  float whole = min(floor(row), SEGMENTS - 1.0);
  vec2 a = texelFetch(uLine, ivec2(int(whole), 0), 0).xy;
  vec2 b = texelFetch(uLine, ivec2(int(whole) + 1, 0), 0).xy;
  return mix(a, b, row - whole);
}

// Time runs right to left and pitch runs up, so a tune can be read like handwriting. What's
// being sung sits at a fixed point, what's been sung trails away behind it, and in a known song
// the next notes can be seen coming.
vec2 place(float u) {
  return vec2((u - HEAD) * 12.0 * uWidth + 2.0 * uWidth, (heard(u).x - 0.5) * 2.6 - 1.0);
}

void main() {
  int quad = gl_VertexID / 6;
  int corner = gl_VertexID % 6;
  float along = (corner == 2 || corner == 3 || corner == 5) ? 1.0 : 0.0;
  float side = (corner == 1 || corner == 4 || corner == 5) ? 1.0 : -1.0;
  float u = (float(quad) + along) / SEGMENTS;

  float step_ = 1.0 / SEGMENTS;
  vec2 here = place(u);
  vec2 heading = place(u + step_) - place(u - step_);
  vec2 across = normalize(vec2(-heading.y, heading.x) + 1e-5);
  float level = heard(u).y;

  float ahead = step(HEAD, u);
  float age = ahead > 0.5 ? (u - HEAD) / (1.0 - HEAD) : (HEAD - u) / HEAD;
  // Fast leaps are left unjoined, so notes read as notes and not as a scribble between them.
  float leap = smoothstep(0.3, 0.6, abs(heading.y));
  float now = exp(-pow((u - HEAD) / 0.012, 2.0));

  vec4 view = modelViewMatrix * vec4(uFocus, 1.0);
  // Thin on the steep parts, or the strokes of a tight curve pile up on each other.
  float steep = 1.0 / (1.0 + abs(heading.y) * 14.0);
  float width = (0.012 + 0.06 * level * (1.0 - age)) * mix(1.0, 0.4, ahead) * steep + 0.09 * level * now;
  view.xy += here + across * side * width;
  gl_Position = projectionMatrix * view;

  vAcross = side;
  vAhead = ahead;
  vAlong = u;
  vHeat = clamp(level * (1.0 - age) + now, 0.0, 1.0);
  float trail = ahead > 0.5 ? 0.5 * (1.0 - age) : pow(1.0 - age, 0.9);
  // The sketch ahead only shows held notes: dashes up a steep slope just read as a comb.
  float sketch = mix(1.0, 1.0 - smoothstep(0.03, 0.09, abs(heading.y)), ahead);
  vLight = smoothstep(0.02, 0.2, level) * trail * (1.0 - leap) * sketch * uFade;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;

varying float vAcross;
varying float vLight;
varying float vHeat;
varying float vAhead;
varying float vAlong;

void main() {
  float edge = 1.0 - vAcross * vAcross;
  // What's still to come is only sketched in.
  float dash = mix(1.0, step(0.45, fract(vAlong * 110.0)), vAhead);
  // Laid over the cloud like ink rather than added to it: added light vanishes on a bright form.
  float ink = sqrt(edge) * vLight * dash;
  gl_FragColor = vec4(mix(uColorA, uColorB, vHeat) * 1.8 * ink, ink);
  #include <colorspace_fragment>
}
`;

/**
 * The lead voice as a line you can read, with pitch as height, which is the most reliable link
 * there is between sound and sight. In a known song the coming notes are sketched in ahead of it.
 * Being real geometry facing the viewer, it stays sharp however the camera moves.
 */
export function MelodyLine() {
  const aspect = useThree((state) => state.size.width / Math.max(1, state.size.height));
  const { geometry, material, data, texture } = useMemo(() => {
    const line = new Float32Array(LINE_ROWS * 4);
    const lineTexture = new DataTexture(line, LINE_ROWS, 1, RGBAFormat, FloatType);
    lineTexture.minFilter = NearestFilter;
    lineTexture.magFilter = NearestFilter;
    lineTexture.needsUpdate = true;

    const strip = new BufferGeometry();
    strip.setDrawRange(0, SEGMENTS * 6);
    strip.boundingSphere = new Sphere(new Vector3(), 10);

    return {
      data: line,
      texture: lineTexture,
      geometry: strip,
      material: new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uLine: { value: lineTexture },
          uFade: { value: 0 },
          uWidth: { value: 1 },
          uFocus: { value: new Vector3() },
          uColorA: { value: new Color() },
          uColorB: { value: new Color() },
        },
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
        side: DoubleSide,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    };
  }, []);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
    [geometry, material, texture],
  );

  const live = useMemo(() => ({ owed: 0, pitch: 0.5 }), []);

  useFrame((state, delta) => {
    const u = material.uniforms;
    const audio = audioFeatures;
    if (audio.scored) {
      for (let row = 0; row < LINE_ROWS; row++) {
        data[row * 4] = audio.line[row * 2] ?? 0;
        data[row * 4 + 1] = audio.line[row * 2 + 1] ?? 0;
      }
    } else {
      // Nothing can be known ahead of live sound, so the line only trails behind the moment.
      live.owed += delta / SECONDS_PER_ROW;
      const head = Math.round(HEAD * SEGMENTS);
      while (live.owed >= 1) {
        live.owed -= 1;
        data.copyWithin(0, 4, (head + 1) * 4);
        live.pitch += (audio.melody - live.pitch) * GLIDE;
        data[head * 4] = live.pitch;
        data[head * 4 + 1] = audio.vocal;
      }
      data.fill(0, (head + 1) * 4);
    }
    texture.needsUpdate = true;

    const shown = audio.living && !sceneDirector.wordFlash ? 1 : 0;
    const fade = u['uFade'];
    if (fade) fade.value += (shown - fade.value) * (1 - Math.exp(-delta / FADE_S));
    if (u['uWidth']) u['uWidth'].value = Math.min(1, aspect / FULL_ASPECT);
    const target = (state.controls as { target?: Vector3 } | null)?.target;
    if (target) (u['uFocus']?.value as Vector3 | undefined)?.copy(target);
    (u['uColorA']?.value as Color | undefined)?.copy(liveLook.palette[2]);
    (u['uColorB']?.value as Color | undefined)?.copy(liveLook.palette[3]);
  });

  return (
    <mesh geometry={geometry} material={material} frustumCulled={false} raycast={() => null} />
  );
}
