import { buildScore, type LaneAudio } from './score';

export interface ScoreJob {
  lanes: LaneAudio;
  sampleRate: number;
  trueStems: boolean;
  mix: { left: Float32Array; right: Float32Array; sampleRate: number };
}

/** A whole song takes over a second to read, which would stall every frame if done on the page. */
const host = self as unknown as Worker;

host.onmessage = ({ data }: MessageEvent<ScoreJob>) => {
  host.postMessage(buildScore(data.lanes, data.sampleRate, data.trueStems, data.mix));
};
