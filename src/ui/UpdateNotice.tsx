import { useEffect, useState } from 'react';
import type { UpdateMessage } from '../live/nowPlaying';
import { useAppStore } from '../state/appStore';

const VERSION_KEY = 'resonance.version';

/** Says once that the app was updated, the first time the new version opens. */
function noteNewVersion(version: string): void {
  let before: string | null = null;
  try {
    before = window.localStorage.getItem(VERSION_KEY);
    window.localStorage.setItem(VERSION_KEY, version);
  } catch {
    return;
  }
  if (before && before !== version) {
    useAppStore.getState().showNotice({
      tone: 'info',
      title: `Updated to Living Notes ${version}`,
      body: 'You’re on the newest version.',
    });
  }
}

/**
 * New versions of the Windows app, out loud: when one is ready, when it's installing, and once
 * it's in. An update that happens without a word looks like a crash.
 */
export function UpdateNotice() {
  const [update, setUpdate] = useState<UpdateMessage | null>(null);
  const [later, setLater] = useState(false);

  useEffect(() => {
    const bridge = window.resonanceDesktop?.updates;
    if (!bridge) return;
    void bridge.version().then((version) => {
      if (version) noteNewVersion(version);
    });
    return bridge.onChange(setUpdate);
  }, []);

  if (update?.state === 'installing') {
    return (
      <div className="update-installing" role="alert">
        <p className="update-installing__title">Updating Living Notes</p>
        <p className="update-installing__body">It’ll open again in a moment.</p>
      </div>
    );
  }
  if (update?.state !== 'ready' || later) return null;
  return (
    <section className="update-card" aria-label="Update ready">
      <p className="update-card__title">Living Notes {update.version} is ready</p>
      <p className="update-card__body">
        Restart now, or it installs when you close the app and opens again straight after.
      </p>
      <div className="name-card__actions">
        <button
          type="button"
          className="name-card__save"
          onClick={() => window.resonanceDesktop?.updates?.install()}
        >
          Restart now
        </button>
        <button type="button" className="name-card__skip" onClick={() => setLater(true)}>
          Later
        </button>
      </div>
    </section>
  );
}
