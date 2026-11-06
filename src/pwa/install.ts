import { create } from 'zustand';

/** Chromium only, and not in the DOM types. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

/** The browser's install offer, held until someone asks for it. Null when there isn't one. */
export const useInstallOffer = create<{ offer: InstallPromptEvent | null }>()(() => ({
  offer: null,
}));

export function watchInstallOffer(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keeps Android's own install banner from popping up over the show.
    event.preventDefault();
    useInstallOffer.setState({ offer: event as InstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => useInstallOffer.setState({ offer: null }));
}

export function installApp(): void {
  const { offer } = useInstallOffer.getState();
  // An offer only works once. If it's turned down, the browser sends a new one later.
  useInstallOffer.setState({ offer: null });
  void offer?.prompt().catch(() => undefined);
}
