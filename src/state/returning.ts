const KEY = 'resonance.returning';

/**
 * Whether this person has brought music here before, so the app should open like a player and
 * not like a welcome. Kept where it can be read at once, before the first frame.
 */
export function isReturning(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function markReturning(): void {
  try {
    window.localStorage.setItem(KEY, '1');
  } catch {
    // Storage blocked: they'll just be welcomed again.
  }
}
