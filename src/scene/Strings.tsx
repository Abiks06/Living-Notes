import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  ShaderMaterial,
  Sphere,
  Vector3,
} from 'three';
import { audioFeatures } from '../audio/features';
import { liveLook } from '../settings/bindings';
import { sceneDirector } from './SceneDirector';

const STRINGS = 14;
const SEGMENTS = 128;
const RING_S = 0.42;
const FADE_IN_S = 0.5;
const FADE_OUT_S = 2.5;
/** How long a string stays up with nothing playing it, in seconds. */
const LINGER_S = 3;

const vertexShader = /* glsl */ `
uniform float uAmp[${STRINGS}];
uniform float uAge[${STRINGS}];
uniform float uStruck[${STRINGS}];
uniform float uGrit;
uniform float uFade;
uniform vec3 uFocus;

varying float vAcross;
varying float vLight;
varying float vHeat;

const float PI = 3.14159265;

// One string's displacement: a kink running out from where it was struck, over a standing wave.
// Clean notes ring as smooth curves, and distortion breaks the same wave into jagged teeth.
float shake(float u, float amp, float age, float struck, float row) {
  float mode = 3.0 + floor(row * 5.0);
  float pinned = sin(PI * u);
  float round_ = sin(PI * u * mode) * cos(age * 34.0);
  float tooth = abs(fract(u * mode * 0.5 + age * 2.2) * 2.0 - 1.0) * 2.0 - 1.0;
  float teeth = tooth * cos(age * 34.0) + 0.35 * sin(u * 130.0 + age * 70.0);
  float travel = abs(u - struck) - age * 2.4;
  float kink = exp(-travel * travel / 0.004) * exp(-age * 3.0);
  return amp * (pinned * mix(round_, teeth, uGrit) * 0.5 + kink * 0.7);
}

void main() {
  int quad = gl_VertexID / 6;
  int corner = gl_VertexID % 6;
  int string_ = quad / ${SEGMENTS};
  float along = (corner == 2 || corner == 3 || corner == 5) ? 1.0 : 0.0;
  float side = (corner == 1 || corner == 4 || corner == 5) ? 1.0 : -1.0;
  float u = (float(quad % ${SEGMENTS}) + along) / ${SEGMENTS}.0;

  float amp = uAmp[string_];
  float row = (float(string_) + 0.5) / ${STRINGS}.0;
  // Pitch runs up the screen. The strings fan out from a waist, like a neck seen from its end.
  float x = u * 2.0 - 1.0;
  float fan = 0.74 + 0.26 * x * x;
  float y = (row - 0.5) * 6.0 * fan + shake(u, amp, uAge[string_], uStruck[string_], row) * 0.9;

  vec4 view = modelViewMatrix * vec4(uFocus, 1.0);
  view.xy += vec2(x * 8.6, y + side * (0.007 + 0.05 * amp));
  gl_Position = projectionMatrix * view;

  vAcross = side;
  vHeat = amp;
  vLight = (0.025 + 1.7 * amp) * uFade * (0.35 + 0.65 * sin(PI * u));
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;

varying float vAcross;
varying float vLight;
varying float vHeat;

void main() {
  float edge = 1.0 - vAcross * vAcross;
  gl_FragColor = vec4(mix(uColorA, uColorB, vHeat), edge * vLight);
  #include <colorspace_fragment>
}
`;

/**
 * Riffs and plucked lines, as strings across the room. Each note strikes the string at its
 * pitch, so a riff can be seen as a shape: its low notes along the bottom and its high ones
 * above, ringing for as long as they do. They only appear in music that plays notes.
 */
export function Strings() {
  const { geometry, material, amp, age, struck } = useMemo(() => {
    const strip = new BufferGeometry();
    strip.setDrawRange(0, STRINGS * SEGMENTS * 6);
    strip.boundingSphere = new Sphere(new Vector3(), 12);
    const levels = new Float32Array(STRINGS);
    const ages = new Float32Array(STRINGS).fill(10);
    const places = new Float32Array(STRINGS).fill(0.5);
    return {
      amp: levels,
      age: ages,
      struck: places,
      geometry: strip,
      material: new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uAmp: { value: levels },
          uAge: { value: ages },
          uStruck: { value: places },
          uGrit: { value: 0 },
          uFade: { value: 0 },
          uFocus: { value: new Vector3() },
          uColorA: { value: new Color() },
          uColorB: { value: new Color() },
        },
        blending: AdditiveBlending,
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
    },
    [geometry, material],
  );

  const clock = useMemo(() => ({ lastCount: 0, sinceNote: Infinity }), []);

  useFrame((state, delta) => {
    const audio = audioFeatures;
    const u = material.uniforms;
    const dt = delta * (1 - audio.hang);
    const decay = Math.exp(-dt / RING_S);
    for (let i = 0; i < STRINGS; i++) {
      amp[i] = (amp[i] ?? 0) * decay;
      age[i] = (age[i] ?? 0) + dt;
    }

    clock.sinceNote += delta;
    const newNote = audio.noteCount !== clock.lastCount;
    clock.lastCount = audio.noteCount;
    // A solo silences the notes but they keep being counted, so only a sounding one is struck.
    if (newNote && audio.noteHit > 0) {
      clock.sinceNote = 0;
      const string = Math.min(STRINGS - 1, Math.floor(audio.notePitch * STRINGS));
      // Over a big held sound a note is a detail, not an event, so the aurora keeps the room.
      const room = 1 - 0.65 * audio.sustain;
      amp[string] = Math.max(amp[string] ?? 0, (0.45 + 0.55 * audio.noteHit) * room);
      age[string] = 0;
      // The same note always strikes in the same place, so a repeated riff makes the same shape.
      struck[string] = 0.25 + 0.5 * ((audio.notePitch * 7.31) % 1);
    }

    const playing = audio.living && clock.sinceNote < LINGER_S && !sceneDirector.wordFlash;
    const fade = u['uFade'];
    if (fade) {
      const tau = playing ? FADE_IN_S : FADE_OUT_S;
      fade.value += ((playing ? 1 : 0) - fade.value) * (1 - Math.exp(-delta / tau));
    }
    if (u['uGrit']) u['uGrit'].value = audio.grit;
    const target = (state.controls as { target?: Vector3 } | null)?.target;
    if (target) (u['uFocus']?.value as Vector3 | undefined)?.copy(target);
    (u['uColorA']?.value as Color | undefined)?.copy(liveLook.palette[2]);
    (u['uColorB']?.value as Color | undefined)?.copy(liveLook.palette[3]);
  });

  return (
    <mesh geometry={geometry} material={material} frustumCulled={false} raycast={() => null} />
  );
}
