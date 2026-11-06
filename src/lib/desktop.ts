/** True inside the Windows app, which serves this same site from its own scheme. */
export const IS_DESKTOP = globalThis.location?.protocol === 'resonance:';

/** The app hears everything Windows plays. A browser can only share what's picked in its dialog. */
export const LIVE_AUDIO_LABEL = IS_DESKTOP ? 'System audio' : 'Tab audio';

/** Always the newest release. Needs at least one published release to exist. */
export const WINDOWS_APP_URL =
  'https://github.com/Abiks06/Living-Notes/releases/latest/download/Resonance-Setup.exe';

/** The installer is 64-bit, and Electron needs Windows 10 or later. WOW64 is a 32-bit browser. */
const WINDOWS_APP_SYSTEM = /Windows NT 1\d.*(?:Win64|WOW64)/;

export function offersWindowsApp(userAgent: string, desktop: boolean): boolean {
  return !desktop && WINDOWS_APP_SYSTEM.test(userAgent);
}
