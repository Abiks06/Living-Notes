import { LANES, type Lane, type LaneAudio, type Score } from './score';
import type { ScoreJob } from './scoreWorker';
import { VOICE_SAMPLE_RATE } from './voices';

/** Which part of the spectrum stands in for each stem when a song has none. */
const BANDS: Record<Lane, { type: BiquadFilterType; frequency: number; q: number }> = {
  kick: { type: 'lowpass', frequency: 110, q: 0.7 },
  snare: { type: 'bandpass', frequency: 2200, q: 0.8 },
  hat: { type: 'highpass', frequency: 7500, q: 0.7 },
  bass: { type: 'lowpass', frequency: 220, q: 0.7 },
  lead: { type: 'bandpass', frequency: 900, q: 0.6 },
};

async function renderBand(buffer: AudioBuffer, lane: Lane): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  const band = BANDS[lane];
  filter.type = band.type;
  filter.frequency.value = band.frequency;
  filter.Q.value = band.q;
  source.connect(filter).connect(ctx.destination);
  source.start();
  return (await ctx.startRendering()).getChannelData(0);
}

/** The mix at the rate voices are read at. The browser's own resampler does the work. */
async function renderVoiceMix(buffer: AudioBuffer): Promise<ScoreJob['mix']> {
  const length = Math.ceil(buffer.duration * VOICE_SAMPLE_RATE);
  const ctx = new OfflineAudioContext(2, length, VOICE_SAMPLE_RATE);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  const rendered = await ctx.startRendering();
  return {
    left: rendered.getChannelData(0),
    right: rendered.getChannelData(1),
    sampleRate: VOICE_SAMPLE_RATE,
  };
}

/** Analyses in a worker. Without one the song simply goes unlearned, and the app reacts live. */
function analyse(job: ScoreJob, handOver: Transferable[]): Promise<Score> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./scoreWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<Score>) => {
      worker.terminate();
      resolve(data);
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error('The song could not be analysed.'));
    };
    try {
      worker.postMessage(job, handOver);
    } catch {
      // Not every browser lets an audio buffer's memory move, and a copy does the same job.
      worker.postMessage(job);
    }
  });
}

/** A score for any song: filtered bands stand in for the stems it doesn't have. */
export async function scoreFromMix(buffer: AudioBuffer): Promise<Score> {
  const [mix, ...rendered] = await Promise.all([
    renderVoiceMix(buffer),
    ...LANES.map((lane) => renderBand(buffer, lane)),
  ]);
  const lanes = Object.fromEntries(LANES.map((lane, i) => [lane, rendered[i]])) as LaneAudio;
  // These were only made for this, so they can move to the worker rather than being copied.
  const handOver = [
    mix.left.buffer,
    mix.right.buffer,
    ...rendered.map((lane) => lane.buffer),
  ] as ArrayBuffer[];
  return analyse({ lanes, sampleRate: buffer.sampleRate, trueStems: false, mix }, handOver);
}

/** A score from real stems, each instrument heard on its own. */
export async function scoreFromStems(
  stems: Record<Lane, AudioBuffer>,
  full: AudioBuffer,
): Promise<Score> {
  const mix = await renderVoiceMix(full);
  const lanes = Object.fromEntries(
    LANES.map((lane) => [lane, stems[lane].getChannelData(0)]),
  ) as LaneAudio;
  return analyse({ lanes, sampleRate: stems.kick.sampleRate, trueStems: true, mix }, [
    mix.left.buffer as ArrayBuffer,
    mix.right.buffer as ArrayBuffer,
  ]);
}
