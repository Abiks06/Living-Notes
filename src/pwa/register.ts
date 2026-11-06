/** Waits for the page to finish loading, so the worker's downloads never compete with it. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener(
    'load',
    () => {
      // Without it the site just works as a normal website.
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    },
    { once: true },
  );
}
