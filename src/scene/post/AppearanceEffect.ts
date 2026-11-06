import { BlendFunction, Effect } from 'postprocessing';
import { Uniform } from 'three';
import type { Appearance } from '../../settings/appearance';

const fragment = /* glsl */ `
uniform float uPaper;
uniform float uWarm;

// Light becomes ink: brightness flips and hue stays, so a red glow turns into red ink on paper
// rather than its cyan negative.
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float light = dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  // Ember pulls every colour part of the way towards the same firelight.
  vec3 colour = mix(inputColor.rgb, light * vec3(1.5, 0.92, 0.5), uWarm * 0.55);
  // Ink is heavier than light: a faint glow still has to leave a mark on the page.
  float weight = pow(light, 0.62);
  vec3 ink = clamp(colour * (weight / max(light, 1e-3)) + 1.0 - 2.0 * weight, 0.0, 1.0);
  ink *= vec3(0.93, 0.88, 0.79);
  outputColor = vec4(mix(colour, ink, uPaper), inputColor.a);
}
`;

const EASE_PER_S = 5;

/** The picture's side of an appearance. Runs last, so it sees the finished image. */
export class AppearanceEffect extends Effect {
  private readonly paper = new Uniform(0);
  private readonly warm = new Uniform(0);

  constructor() {
    super('AppearanceEffect', fragment, { blendFunction: BlendFunction.NORMAL });
    this.uniforms.set('uPaper', this.paper);
    this.uniforms.set('uWarm', this.warm);
  }

  follow(appearance: Appearance, dt: number): void {
    const ease = 1 - Math.exp(-EASE_PER_S * dt);
    this.paper.value += ((appearance === 'paper' ? 1 : 0) - this.paper.value) * ease;
    this.warm.value += ((appearance === 'ember' ? 1 : 0) - this.warm.value) * ease;
  }
}
