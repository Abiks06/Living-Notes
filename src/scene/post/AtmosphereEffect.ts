import { BlendFunction, Effect } from 'postprocessing';
import { Color, Uniform } from 'three';
import { harmonicCentre } from '../harmony';

const fragment = /* glsl */ `
uniform vec3 uTint;
uniform vec3 uTintB;
uniform float uStrength;
uniform float uSpread;
uniform float uClock;
uniform float uBass;
uniform float uVocal;
uniform float uLoud;
uniform float uAurora;
uniform float uWipe;
uniform vec3 uChordFrom;
uniform vec3 uChordTo;

// Curtains of light hanging across the top of the room, folded by two slow waves and combed
// into rays. They're the one thing here with no sharp edges and no quick moves, which is what
// a held sound is.
float curtain(vec2 uv, float clock, float offset) {
  float x = (uv.x - 0.5) * aspect + offset;
  float hem = 0.46 + 0.2 * sin(x * 1.7 + clock * 0.21 + offset) + 0.1 * sin(x * 3.9 - clock * 0.33);
  float rise = uv.y - hem;
  // Bright at the hem and fading upward, as the real thing does, with no hard line anywhere.
  float body = smoothstep(-0.32, 0.1, rise) * exp(-max(rise, 0.0) * 3.2);
  float rays = 0.5 + 0.5 * sin(x * 9.0 + 2.6 * sin(x * 2.3 + clock * 0.4) + clock * 0.5);
  rays = rays * rays * (0.7 + 0.3 * sin(x * 31.0 - clock * 0.9 + 3.0 * sin(x * 5.1 + clock * 0.2)));
  return body * (0.25 + 0.75 * rays);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float glow = smoothstep(mix(0.85, 1.5, uSpread), 0.0, distance(uv, vec2(0.5, 0.52)));
  // Two colours drift through each other as slow clouds, so the room's light is never flat.
  float drift = 0.5 + 0.5 * sin(uv.x * 3.1 + uClock * 0.11 + 1.7 * sin(uv.y * 2.3 - uClock * 0.07));
  // Interleaved gradient noise: a dark gradient would otherwise band visibly on 8-bit screens.
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 mood = mix(uTint, uTintB, drift);
  vec3 air = mood * glow * glow * uStrength + (dither - 0.5) / 255.0;
  // Bass rises from the floor, a voice drifts across the sky, and loud sections reach the edges.
  float horizon = smoothstep(0.42, 0.0, uv.y) * uBass;
  float wave = 0.5 + 0.5 * sin(uv.x * 4.7 - uClock * 0.09 + 2.0 * sin(uv.y * 3.0 + uClock * 0.05));
  float veil = smoothstep(0.5, 1.0, uv.y) * wave * uVocal;
  vec2 fromCentre = abs(uv - 0.5) * 2.0;
  float edge = pow(max(fromCentre.x, fromCentre.y), 3.0) * uLoud;
  air += uTint * horizon * 0.07 + uTintB * veil * 0.05 + mood * edge * 0.035;
  if (uAurora > 0.002) {
    float light = curtain(uv, uClock, 0.0) + 0.6 * curtain(uv, uClock * 0.8, 2.7);
    // A new chord sweeps across the room rather than appearing everywhere at once.
    vec3 chord = mix(uChordTo, uChordFrom, smoothstep(uWipe - 0.25, uWipe + 0.25, uv.x * 1.5 - 0.25));
    air += chord * light * uAurora;
  }
  outputColor = vec4(inputColor.rgb + air, inputColor.a);
}
`;

const BASE_STRENGTH = 0.012;
const SECTION_STRENGTH = 0.03;
const BASS_STRENGTH = 0.05;
/** A calm song keeps a low lamp; an intense one fills more of the room. */
const MOOD_STRENGTH = 0.03;
/** Lounge mode: bright enough on a big screen in a dark room to light the room itself. */
const LOUNGE_STRENGTH = 0.14;
const AURORA_STRENGTH = 0.5;
/** How long a new chord takes to cross the room. */
const CHORD_SWEEP_S = 1.1;
const CHORD_SATURATION = 1;
const CHORD_LIGHTNESS = 0.5;
/** How far a chord's own colour wins over the palette's. */
const CHORD_SHARE = 0.9;

export interface Room {
  subBass: number;
  section: number;
  arousal: number;
  inhale: number;
  vocal: number;
  sustain: number;
  tension: number;
  chroma: Float32Array;
  chordCount: number;
  living: boolean;
}

/**
 * The void isn't black: two palette colours drifting behind the particles, swelling with
 * sub-bass, the section's loudness and the song's mood, and held back through the breath
 * before a drop. It merges into the existing effect pass, so it adds no full-screen draw.
 */
export class AtmosphereEffect extends Effect {
  private readonly tint = new Color(0, 0, 0);
  private readonly tintB = new Color(0, 0, 0);
  private readonly strength = new Uniform(BASE_STRENGTH);
  private readonly spread = new Uniform(0);
  private readonly clock = new Uniform(0);
  private readonly bass = new Uniform(0);
  private readonly vocal = new Uniform(0);
  private readonly loud = new Uniform(0);
  private readonly aurora = new Uniform(0);
  private readonly wipe = new Uniform(1);
  private readonly chordFrom = new Color();
  private readonly chordTo = new Color();
  private readonly centre = { x: 0, y: 0 };
  private lastChords = -1;

  constructor() {
    super('AtmosphereEffect', fragment, { blendFunction: BlendFunction.NORMAL });
    this.uniforms.set('uTint', new Uniform(this.tint));
    this.uniforms.set('uTintB', new Uniform(this.tintB));
    this.uniforms.set('uStrength', this.strength);
    this.uniforms.set('uSpread', this.spread);
    this.uniforms.set('uClock', this.clock);
    this.uniforms.set('uBass', this.bass);
    this.uniforms.set('uVocal', this.vocal);
    this.uniforms.set('uLoud', this.loud);
    this.uniforms.set('uAurora', this.aurora);
    this.uniforms.set('uWipe', this.wipe);
    this.uniforms.set('uChordFrom', new Uniform(this.chordFrom));
    this.uniforms.set('uChordTo', new Uniform(this.chordTo));
  }

  /** Eases toward the palette, so switching palettes shifts the room gently. */
  follow(target: Color, second: Color, audio: Room, lounge: boolean, dt: number): void {
    const ease = 1 - Math.exp(-dt / 0.4);
    this.tint.lerp(target, ease);
    this.tintB.lerp(second, ease);
    this.clock.value += dt;
    const room = lounge ? 1 : 0;
    this.spread.value += (room - this.spread.value) * (1 - Math.exp(-dt / 1.5));
    const lit =
      BASE_STRENGTH +
      audio.section * SECTION_STRENGTH +
      audio.subBass * BASS_STRENGTH +
      audio.arousal * MOOD_STRENGTH +
      this.spread.value * LOUNGE_STRENGTH;
    const held = 1 - audio.inhale * 0.8;
    this.strength.value = lit * held;
    this.bass.value = audio.subBass * held;
    this.vocal.value = audio.vocal * held;
    this.loud.value = audio.section * held;
    this.followChords(audio, target, dt);
    const climbing = 1 - audio.tension * 0.7;
    this.aurora.value = audio.living ? audio.sustain * AURORA_STRENGTH * held * climbing : 0;
  }

  /** Each chord has a colour of its own: its place on the circle of fifths, as a hue. */
  private followChords(audio: Room, palette: Color, dt: number): void {
    this.wipe.value = Math.min(1, this.wipe.value + dt / CHORD_SWEEP_S);
    if (audio.chordCount === this.lastChords) return;
    const first = this.lastChords < 0;
    this.lastChords = audio.chordCount;
    harmonicCentre(audio.chroma, this.centre);
    const hue = Math.atan2(this.centre.x, this.centre.y) / (Math.PI * 2) + 1;
    this.chordFrom.copy(this.chordTo);
    this.chordTo.setHSL(hue % 1, CHORD_SATURATION, CHORD_LIGHTNESS).lerp(palette, 1 - CHORD_SHARE);
    if (first) this.chordFrom.copy(this.chordTo);
    this.wipe.value = first ? 1 : 0;
  }
}
