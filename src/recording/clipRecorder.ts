/** Container/codec preferences, best first. MP4 leads: social platforms take it, not WebM. */
const CANDIDATES = [
  { mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2', extension: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
  { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
  { mimeType: 'video/webm', extension: 'webm' },
  { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4' },
  { mimeType: 'video/mp4', extension: 'mp4' },
] as const;

export type RecordingFormat = (typeof CANDIDATES)[number];

export type RecordingSupport =
  { ok: true; format: RecordingFormat } | { ok: false; reason: string };

let cachedSupport: RecordingSupport | null = null;

export function recordingSupport(): RecordingSupport {
  if (cachedSupport) return cachedSupport;
  const canCapture =
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function';
  if (!canCapture || typeof MediaRecorder === 'undefined') {
    cachedSupport = { ok: false, reason: 'This browser can’t record the canvas.' };
    return cachedSupport;
  }
  const format = CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c.mimeType));
  cachedSupport = format
    ? { ok: true, format }
    : { ok: false, reason: 'This browser can’t encode WebM or MP4 video.' };
  return cachedSupport;
}

export interface RecordedClip {
  readonly blob: Blob;
  readonly format: RecordingFormat;
  readonly seconds: number;
  readonly hasAudio: boolean;
}

export interface ClipRecording {
  /** Resolves with the clip when the duration elapses or `stop()` is called. */
  readonly done: Promise<RecordedClip>;
  /** Ends early, keeping what was recorded so far. */
  stop(): void;
}

interface RecordOptions {
  canvas: HTMLCanvasElement;
  /** Shared with the audio engine: its tracks must outlive the recording. */
  audio: MediaStream | null;
  seconds: number;
  onProgress?: (elapsedSeconds: number) => void;
}

/**
 * Encoding is what costs, not capturing, and the codec barely matters. On Iris Xe with 262k
 * particles and nothing over the canvas, the live show held 60 FPS encoding at this rate but
 * fell to about 50 at 60 FPS with either H.264 or VP9. A steady 30 beats a ragged 60.
 */
const CAPTURE_FPS = 30;
const VIDEO_BITRATE = 12_000_000;
const AUDIO_BITRATE = 192_000;
const PROGRESS_INTERVAL_MS = 100;

/** canvas.captureStream + the engine's audio → MediaRecorder → one Blob. */
export function recordClip({ canvas, audio, seconds, onProgress }: RecordOptions): ClipRecording {
  const support = recordingSupport();
  if (!support.ok) throw new Error(support.reason);

  const video = canvas.captureStream(CAPTURE_FPS);
  const audioTracks = audio?.getAudioTracks() ?? [];
  const recorder = new MediaRecorder(new MediaStream([...video.getVideoTracks(), ...audioTracks]), {
    mimeType: support.format.mimeType,
    videoBitsPerSecond: VIDEO_BITRATE,
    audioBitsPerSecond: AUDIO_BITRATE,
  });

  const chunks: Blob[] = [];
  const started = performance.now();
  let timer = 0;

  const done = new Promise<RecordedClip>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => {
      window.clearInterval(timer);
      video.getTracks().forEach((track) => track.stop());
      reject(new Error('The recorder stopped unexpectedly.'));
    };
    recorder.onstop = () => {
      window.clearInterval(timer);
      // Only the canvas track is ours to stop; the audio track belongs to the engine.
      video.getTracks().forEach((track) => track.stop());
      resolve({
        blob: new Blob(chunks, { type: support.format.mimeType }),
        format: support.format,
        seconds: Math.min(seconds, (performance.now() - started) / 1000),
        hasAudio: audioTracks.length > 0,
      });
    };
  });

  const stop = () => {
    if (recorder.state !== 'inactive') recorder.stop();
  };

  recorder.start(250);
  timer = window.setInterval(() => {
    const elapsed = (performance.now() - started) / 1000;
    onProgress?.(Math.min(elapsed, seconds));
    if (elapsed >= seconds) stop();
  }, PROGRESS_INTERVAL_MS);

  return { done, stop };
}

export function downloadBlob(blob: Blob, baseName: string, extension: string): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const fileName = `${baseName}-${stamp}.${extension}`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser time to start the download before releasing the blob.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return fileName;
}
