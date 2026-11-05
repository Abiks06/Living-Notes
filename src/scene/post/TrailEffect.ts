import { BlendFunction, Effect } from 'postprocessing';
import {
  HalfFloatType,
  ShaderMaterial,
  type Texture,
  Uniform,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const MAX_DECAY = 0.94;

const blendMaterialShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D uCurrent;
    uniform sampler2D uPrevious;
    uniform float uDecay;
    varying vec2 vUv;
    void main() {
      // max() rather than accumulation: a resting particle can never brighten past itself.
      gl_FragColor = max(texture2D(uCurrent, vUv), texture2D(uPrevious, vUv) * uDecay);
    }
  `,
};

const effectShader = /* glsl */ `
uniform sampler2D uTrail;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = texture2D(uTrail, uv);
}
`;

/**
 * Feedback trails: each frame keeps the brighter of the new image and a decayed copy of
 * the last result. Owns its own ping-pong targets because postprocessing's Effects only
 * see the current frame.
 */
export class TrailEffect extends Effect {
  /** 0 = no trails, 1 = longest trails. Decay is frame-rate independent. */
  amount = 0.7;

  private readonly targets: [WebGLRenderTarget, WebGLRenderTarget];
  private readonly blend: ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private index = 0;

  constructor() {
    super('TrailEffect', effectShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([['uTrail', new Uniform<Texture | null>(null)]]),
    });
    const options = { type: HalfFloatType, depthBuffer: false };
    this.targets = [new WebGLRenderTarget(1, 1, options), new WebGLRenderTarget(1, 1, options)];
    this.blend = new ShaderMaterial({
      ...blendMaterialShader,
      uniforms: {
        uCurrent: { value: null },
        uPrevious: { value: null },
        uDecay: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.blend);
  }

  override update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, deltaTime = 1 / 60) {
    const trail = this.uniforms.get('uTrail');
    if (!trail) return;
    if (this.amount <= 0.001) {
      trail.value = inputBuffer.texture;
      return;
    }
    const read = this.targets[this.index];
    const write = this.targets[1 - this.index];
    if (!read || !write) return;

    const perFrame = MAX_DECAY * Math.min(1, this.amount);
    const uniforms = this.blend.uniforms;
    if (uniforms.uCurrent) uniforms.uCurrent.value = inputBuffer.texture;
    if (uniforms.uPrevious) uniforms.uPrevious.value = read.texture;
    if (uniforms.uDecay) uniforms.uDecay.value = perFrame ** (deltaTime * 60);

    renderer.setRenderTarget(write);
    this.quad.render(renderer);
    trail.value = write.texture;
    this.index = 1 - this.index;
  }

  override setSize(width: number, height: number): void {
    // New size starts with clean history (stale trails would be stretched).
    for (const target of this.targets) target.setSize(width, height);
  }

  override dispose(): void {
    for (const target of this.targets) target.dispose();
    this.blend.dispose();
    this.quad.dispose();
    super.dispose();
  }
}
