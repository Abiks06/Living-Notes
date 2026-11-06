import { AudioError } from './errors';
import { IS_DESKTOP } from '../lib/desktop';

/** Play/pause/seek controls. Positions are in seconds. */
export interface Transport {
  readonly duration: number;
  readonly paused: boolean;
  currentTime(): number;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
}

/** A playing source. `monitored` sources are audible; the mic is analysed silently. */
export interface PlaybackHandle {
  readonly node: AudioNode;
  readonly monitored: boolean;
  /** Whether its audio may reach a recorded clip. Required, so a new source has to decide. */
  readonly recordable: boolean;
  /** Reached us through the air, so it carries room noise that needs gating out. */
  readonly acoustic?: boolean;
  readonly transport?: Transport;
  /** Live sources report when they stop by themselves. */
  onEnded?(listener: () => void): void;
  stop(): void;
}

function clampTime(seconds: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(Math.max(0, seconds), duration - 0.01);
}

/**
 * Loops a decoded buffer. AudioBufferSourceNodes are one-shot, so pause and seek
 * stop the node and start a fresh one at the remembered offset.
 */
export function playBuffer(ctx: AudioContext, buffer: AudioBuffer): PlaybackHandle {
  const output = ctx.createGain();
  let node: AudioBufferSourceNode | null = null;
  let startedAt = 0;
  let offset = 0;
  let paused = false;

  const position = () => (paused ? offset : (ctx.currentTime - startedAt) % buffer.duration);

  const start = (at: number) => {
    node = ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = true;
    node.connect(output);
    node.start(0, at);
    startedAt = ctx.currentTime - at;
  };

  const halt = () => {
    if (!node) return;
    try {
      node.stop();
    } catch {
      // Already stopped.
    }
    node.disconnect();
    node = null;
  };

  start(0);

  return {
    node: output,
    monitored: true,
    recordable: true,
    transport: {
      get duration() {
        return buffer.duration;
      },
      get paused() {
        return paused;
      },
      currentTime: position,
      play() {
        if (!paused) return;
        paused = false;
        start(offset);
      },
      pause() {
        if (paused) return;
        offset = position();
        paused = true;
        halt();
      },
      seek(seconds) {
        offset = clampTime(seconds, buffer.duration);
        if (!paused) {
          halt();
          start(offset);
        }
      },
    },
    stop() {
      halt();
      output.disconnect();
    },
  };
}

/** Streams a URL through an <audio> element so long files never sit fully decoded in memory. */
export async function playMediaUrl(
  ctx: AudioContext,
  url: string,
  options: { revokeOnStop?: boolean; loop?: boolean } = {},
): Promise<PlaybackHandle> {
  const element = new Audio();
  element.crossOrigin = 'anonymous';
  element.loop = options.loop ?? true;
  element.preload = 'auto';
  element.src = url;
  const node = ctx.createMediaElementSource(element);

  const stop = () => {
    element.pause();
    node.disconnect();
    element.removeAttribute('src');
    element.load();
    if (options.revokeOnStop) URL.revokeObjectURL(url);
  };

  try {
    await element.play();
  } catch (error) {
    stop();
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new AudioError('autoplay-blocked', 'The browser blocked playback.', { cause: error });
    }
    throw new AudioError('decode', 'This file could not be decoded.', { cause: error });
  }

  return {
    node,
    monitored: true,
    recordable: true,
    onEnded(listener) {
      element.addEventListener('ended', listener, { once: true });
    },
    transport: {
      get duration() {
        return element.duration;
      },
      get paused() {
        return element.paused;
      },
      currentTime: () => element.currentTime,
      play() {
        void element.play().catch(() => undefined);
      },
      pause() {
        element.pause();
      },
      seek(seconds) {
        element.currentTime = clampTime(seconds, element.duration);
      },
    },
    stop,
  };
}

/** Audio inputs by name. Browsers only reveal names once mic permission has been granted. */
export async function listAudioInputs(): Promise<{ id: string; label: string }[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return (
    devices
      .filter((device) => device.kind === 'audioinput' && device.label !== '')
      // Chromium's aliases for a real input in this list; "System default" already covers them.
      .filter((device) => device.deviceId !== 'default' && device.deviceId !== 'communications')
      .map((device) => ({ id: device.deviceId, label: device.label }))
  );
}

export async function openMicrophone(
  ctx: AudioContext,
  deviceId: string | null = null,
): Promise<PlaybackHandle> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new AudioError('mic-unsupported', 'Microphone access is not available here.');
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // Raw signal: voice-call processing would flatten exactly the transients we detect.
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new AudioError('mic-denied', 'Microphone permission was denied.', { cause: error });
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new AudioError('mic-missing', 'No microphone was found.', { cause: error });
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
      throw new AudioError('mic-busy', 'The microphone is in use.', { cause: error });
    }
    throw new AudioError('unknown', 'The microphone could not be opened.', { cause: error });
  }

  return liveStreamHandle(ctx, stream, stream.getAudioTracks(), 'mic');
}

function liveStreamHandle(
  ctx: AudioContext,
  stream: MediaStream,
  audioTracks: MediaStreamTrack[],
  kind: 'mic' | 'tab',
): PlaybackHandle {
  const node = ctx.createMediaStreamSource(new MediaStream(audioTracks));
  return {
    node,
    monitored: false,
    recordable: kind === 'mic',
    acoustic: kind === 'mic',
    onEnded(listener) {
      audioTracks[0]?.addEventListener('ended', listener, { once: true });
    },
    stop() {
      node.disconnect();
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}

export function isTabAudioSupported(): boolean {
  return (
    typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
    // Phones can't share audio, but the Windows app can on a touch screen.
    (IS_DESKTOP || !window.matchMedia('(pointer: coarse)').matches)
  );
}

/**
 * Captures another tab's (or the system's) audio via screen sharing, so Spotify, YouTube or
 * SoundCloud can drive the visuals. Browsers require a video track in the request; it is
 * kept tiny and never displayed. Chrome and Edge share tab audio; Firefox and Safari don't.
 */
export async function openTabAudio(ctx: AudioContext): Promise<PlaybackHandle> {
  if (!isTabAudioSupported() || !window.isSecureContext) {
    throw new AudioError('tab-unsupported', 'Tab audio capture is not available here.');
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 1 }, width: { ideal: 320 } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      // Chromium hints: offer tabs with audio, hide this tab, allow system audio.
      selfBrowserSurface: 'exclude',
      systemAudio: 'include',
    } as DisplayMediaStreamOptions);
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'AbortError') {
      throw new AudioError('tab-cancelled', 'Sharing was cancelled.', { cause: error });
    }
    throw new AudioError('tab-unsupported', 'Tab audio capture failed.', { cause: error });
  }

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    stream.getTracks().forEach((track) => track.stop());
    throw new AudioError('tab-no-audio', 'The shared surface had no audio.');
  }
  // In the app the sound comes from Windows itself, so the screen capture has no job to do.
  if (IS_DESKTOP) stream.getVideoTracks().forEach((track) => track.stop());
  return liveStreamHandle(ctx, stream, audioTracks, 'tab');
}
