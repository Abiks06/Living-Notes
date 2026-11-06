import { IS_DESKTOP } from '../lib/desktop';

/** Waits for the page to finish loading, so the worker's downloads never compete with it. */
export function registerServiceWorker(): void {
  // The Windows app's files are already on disk.
  if (!import.meta.env.PROD || IS_DESKTOP || !('serviceWorker' in navigator)) return;
  window.addEventListener(
    'load',
    () => {
      // Without it the site just works as a normal website.
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    },
    { once: true },
  );
}
