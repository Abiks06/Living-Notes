/** Tiny drum-machine / synth voices scheduled on an (offline) audio context. */
export interface Rig {
  readonly ctx: BaseAudioContext;
  readonly out: AudioNode;
  readonly noise: AudioBuffer;
}

export function midiToHz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

export function createNoise(ctx: BaseAudioContext, seconds = 1): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 1234567;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return buffer;
}

function envelope(rig: Rig, t: number, peak: number, attack: number, decay: number): GainNode {
  const gain = rig.ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return gain;
}

function noiseBurst(rig: Rig, t: number, filter: BiquadFilterNode, env: GainNode, length: number) {
  const src = rig.ctx.createBufferSource();
  src.buffer = rig.noise;
  src.connect(filter).connect(env).connect(rig.out);
  src.start(t, (t * 7.31) % 0.5);
  src.stop(t + length);
}

function panned(rig: Rig, pan: number): AudioNode {
  const panner = rig.ctx.createStereoPanner();
  panner.pan.value = pan;
  panner.connect(rig.out);
  return panner;
}

export function kick(rig: Rig, t: number, peak = 1): void {
  const osc = rig.ctx.createOscillator();
  osc.frequency.setValueAtTime(165, t);
  osc.frequency.exponentialRampToValueAtTime(42, t + 0.13);
  const env = envelope(rig, t, peak, 0.003, 0.42);
  osc.connect(env).connect(rig.out);
  osc.start(t);
  osc.stop(t + 0.5);
}

export function snare(rig: Rig, t: number, peak = 0.5): void {
  const filter = rig.ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1900;
  filter.Q.value = 0.7;
  noiseBurst(rig, t, filter, envelope(rig, t, peak, 0.002, 0.2), 0.25);

  const body = rig.ctx.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(200, t);
  body.frequency.exponentialRampToValueAtTime(150, t + 0.1);
  body.connect(envelope(rig, t, peak * 0.6, 0.002, 0.12)).connect(rig.out);
  body.start(t);
  body.stop(t + 0.16);
}

export function clap(rig: Rig, t: number, peak = 0.45): void {
  for (let i = 0; i < 3; i++) {
    const filter = rig.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1300;
    filter.Q.value = 1.1;
    const at = t + i * 0.011;
    noiseBurst(rig, at, filter, envelope(rig, at, peak, 0.001, i === 2 ? 0.18 : 0.02), 0.22);
  }
}

export function hat(rig: Rig, t: number, peak = 0.16, open = false, pan = 0.2): void {
  const filter = rig.ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 7600;
  const env = envelope(rig, t, peak, 0.001, open ? 0.24 : 0.045);
  const src = rig.ctx.createBufferSource();
  src.buffer = rig.noise;
  src.connect(filter).connect(env).connect(panned(rig, pan));
  src.start(t, (t * 3.17) % 0.5);
  src.stop(t + (open ? 0.3 : 0.08));
}

export function bass(rig: Rig, t: number, note: number, length: number, peak = 0.32, detune = 0) {
  const filter = rig.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 6;
  filter.frequency.setValueAtTime(1100, t);
  filter.frequency.exponentialRampToValueAtTime(180, t + Math.min(length, 0.25));
  const env = rig.ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  env.gain.setValueAtTime(peak, t + length * 0.8);
  env.gain.exponentialRampToValueAtTime(0.0001, t + length);
  filter.connect(env).connect(rig.out);

  const cents = detune === 0 ? [0] : [-detune, detune];
  for (const c of cents) {
    const osc = rig.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = midiToHz(note);
    osc.detune.value = c;
    osc.connect(filter);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }
}

export function sub(rig: Rig, t: number, note: number, length: number, peak = 0.5): void {
  const osc = rig.ctx.createOscillator();
  osc.frequency.value = midiToHz(note);
  const env = rig.ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + 0.03);
  env.gain.setValueAtTime(peak, t + length * 0.85);
  env.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(env).connect(rig.out);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

export function pad(rig: Rig, t: number, notes: readonly number[], length: number, peak = 0.06) {
  const filter = rig.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(700, t);
  filter.frequency.linearRampToValueAtTime(2200, t + length * 0.5);
  filter.frequency.linearRampToValueAtTime(900, t + length);
  const env = rig.ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(peak, t + length * 0.3);
  env.gain.linearRampToValueAtTime(0.0001, t + length);
  filter.connect(env);
  const left = panned(rig, -0.6);
  const right = panned(rig, 0.6);
  env.connect(left);
  env.connect(right);

  for (const note of notes) {
    for (const cents of [-9, 9]) {
      const osc = rig.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiToHz(note);
      osc.detune.value = cents;
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + length + 0.05);
    }
  }
}

export function pluck(rig: Rig, t: number, note: number, peak = 0.09, pan = 0): void {
  const osc = rig.ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = midiToHz(note);
  const filter = rig.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(4200, t);
  filter.frequency.exponentialRampToValueAtTime(500, t + 0.18);
  osc
    .connect(filter)
    .connect(envelope(rig, t, peak, 0.003, 0.24))
    .connect(panned(rig, pan));
  osc.start(t);
  osc.stop(t + 0.3);
}
