/** True inside the Windows app, which serves this same site from its own scheme. */
export const IS_DESKTOP = globalThis.location?.protocol === 'resonance:';

/** The app hears everything Windows plays. A browser can only share what's picked in its dialog. */
export const LIVE_AUDIO_LABEL = IS_DESKTOP ? 'System audio' : 'Tab audio';
