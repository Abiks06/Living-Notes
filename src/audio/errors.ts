export type AudioErrorKind =
  | 'audio-unsupported'
  | 'decode'
  | 'autoplay-blocked'
  | 'mic-denied'
  | 'mic-unsupported'
  | 'mic-missing'
  | 'mic-busy'
  | 'tab-unsupported'
  | 'tab-no-audio'
  | 'tab-cancelled'
  | 'unknown';

/** Errors the UI knows how to explain. Anything else is reported as `unknown`. */
export class AudioError extends Error {
  readonly kind: AudioErrorKind;

  constructor(kind: AudioErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AudioError';
    this.kind = kind;
  }
}

export function toAudioError(error: unknown): AudioError {
  if (error instanceof AudioError) return error;
  return new AudioError('unknown', 'Something went wrong with audio playback.', { cause: error });
}
