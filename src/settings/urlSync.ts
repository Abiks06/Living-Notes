import { readSettings, useSettings } from './settingsStore';
import { encodeSettings, settingsFromHash } from './urlState';

const WRITE_DELAY_MS = 250;

/**
 * Keeps the URL hash and the settings store in sync:
 * - on load, a shared link's hash becomes the starting look;
 * - edits are written back (debounced, via replaceState so dragging a slider
 *   doesn't fill the back button with hundreds of entries);
 * - pasting a different link into the same tab applies it.
 */
export function initUrlSync(): () => void {
  useSettings.getState().replace(settingsFromHash(window.location.hash));

  let timer = 0;
  let lastWritten = encodeSettings(readSettings());

  const unsubscribe = useSettings.subscribe(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const hash = encodeSettings(readSettings());
      if (hash === lastWritten) return;
      lastWritten = hash;
      const { pathname, search } = window.location;
      window.history.replaceState(window.history.state, '', hash ? `#${hash}` : pathname + search);
    }, WRITE_DELAY_MS);
  });

  const onHashChange = () => {
    const hash = window.location.hash.replace(/^#/, '');
    if (hash === lastWritten) return;
    lastWritten = hash;
    useSettings.getState().replace(settingsFromHash(hash));
  };
  window.addEventListener('hashchange', onHashChange);

  return () => {
    window.clearTimeout(timer);
    unsubscribe();
    window.removeEventListener('hashchange', onHashChange);
  };
}

/** The current page URL including the look, for the "Copy link" button. */
export function shareUrl(): string {
  const hash = encodeSettings(readSettings());
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}${hash ? `#${hash}` : ''}`;
}
