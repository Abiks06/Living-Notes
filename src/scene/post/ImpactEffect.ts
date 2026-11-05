import { BlendFunction, Effect } from 'postprocessing';
import { Color, Uniform } from 'three';

const fragment = /* glsl */ `
uniform float uRadius;
uniform float uRipple;
uniform float uFlash;
uniform float uDim;
uniform float uVivid;
uniform vec3 uTint;
uniform float uHue;

// The whole picture's colour turned around the grey axis, keeping its brightness.
vec3 turnHue(vec3 colour, float turn) {
  const vec3 axis = vec3(0.57735);
  float c = cos(turn);
  return colour * c + cross(axis, colour) * sin(turn) + axis * dot(axis, colour) * (1.0 - c);
}

// The air itself gets hit: one ring of bent light runs out from the centre of the screen.
void mainUv(inout vec2 uv) {
  if (uRipple <= 0.0) return;
  vec2 fromCentre = (uv - 0.5) * vec2(aspect, 1.0);
  float front = (length(fromCentre) - uRadius) / 0.12;
  vec2 outward = normalize(fromCentre + 1e-5) / vec2(aspect, 1.0);
  uv -= outward * front * exp(-front * front) * uRipple;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 turned = max(turnHue(inputColor.rgb, uHue), 0.0);
  float grey = dot(turned, vec3(0.2126, 0.7152, 0.0722));
  vec3 colour = mix(vec3(grey), turned, 1.0 + uVivid) * (1.0 - uDim);
  outputColor = vec4(colour + uTint * uFlash, inputColor.a);
}
`;

const RIPPLE_SPEED = 1.5;
const RIPPLE_FADE_S = 0.28;
const RIPPLE_SIZE = 0.05;
const FLASH = 0.42;
/** Reduced motion keeps a soft lift of light: no ripple, and nothing that reads as a flash. */
const CALM_FLASH = 0.1;
const CLIMB_DIM = 0.42;
const HANG_DIM = 0.3;
const CLIMB_DRAIN = 0.6;
const WORLD_VIVID = 0.24;
/** How far a drop must jump in one frame to count as a new one. */
const NEW_HIT = 0.3;

export interface DropLight {
  hit: number;
  tension: number;
  hang: number;
  world: number;
  calm: boolean;
  /** Fraction of the hue circle to turn the picture by. */
  hue: number;
}

/**
 * What a drop does to the picture as a whole. The climb drains its colour and light, and the
 * hit gives them back at once with a flash and a ring through the air. Drops are bars apart,
 * so flashes stay far below the three a second that risk triggering seizures.
 */
export class ImpactEffect extends Effect {
  private readonly tint = new Color();
  private readonly radius = new Uniform(0);
  private readonly ripple = new Uniform(0);
  private readonly flash = new Uniform(0);
  private readonly dim = new Uniform(0);
  private readonly vivid = new Uniform(0);
  private readonly hue = new Uniform(0);
  private age = Infinity;
  private strength = 0;
  private lastHit = 0;

  constructor() {
    super('ImpactEffect', fragment, { blendFunction: BlendFunction.NORMAL });
    this.uniforms.set('uTint', new Uniform(this.tint));
    this.uniforms.set('uRadius', this.radius);
    this.uniforms.set('uRipple', this.ripple);
    this.uniforms.set('uFlash', this.flash);
    this.uniforms.set('uDim', this.dim);
    this.uniforms.set('uVivid', this.vivid);
    this.uniforms.set('uHue', this.hue);
  }

  follow(light: DropLight, tint: Color, dt: number): void {
    if (light.hit - this.lastHit > NEW_HIT) {
      this.age = 0;
      this.strength = light.hit;
    }
    this.lastHit = light.hit;
    this.age += dt;

    this.tint.copy(tint);
    this.radius.value = this.age * RIPPLE_SPEED;
    this.ripple.value = light.calm
      ? 0
      : this.strength * RIPPLE_SIZE * Math.exp(-this.age / RIPPLE_FADE_S);
    if (this.ripple.value < 1e-4) this.ripple.value = 0;
    this.flash.value = light.hit ** 3 * (light.calm ? CALM_FLASH : FLASH);
    this.dim.value = light.tension * CLIMB_DIM + light.hang * HANG_DIM;
    this.vivid.value = light.world * WORLD_VIVID - light.tension * CLIMB_DRAIN;
    this.hue.value = light.hue * Math.PI * 2;
  }
}
