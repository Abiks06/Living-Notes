import { useState } from 'react';
import { useSettings } from '../../settings/settingsStore';
import { shareUrl } from '../../settings/urlSync';
import { useAppStore } from '../../state/appStore';
import { LinkIcon } from '../icons';
import { Section } from './controls';

export function ShareSection() {
  const reset = useSettings((state) => state.reset);
  const showNotice = useAppStore((state) => state.showNotice);
  // Shown only when the clipboard is unavailable, so the link can be copied by hand.
  const [manualUrl, setManualUrl] = useState<string | null>(null);

  const copy = async () => {
    const url = shareUrl();
    try {
      await navigator.clipboard.writeText(url);
      setManualUrl(null);
      showNotice({
        tone: 'info',
        title: 'Link copied',
        body: 'Anyone who opens it sees exactly this look.',
      });
    } catch {
      setManualUrl(url);
    }
  };

  return (
    <Section title="Share">
      <div className="studio-actions">
        <button type="button" className="button button--primary" onClick={() => void copy()}>
          <LinkIcon width={16} height={16} /> Copy link
        </button>
        <button type="button" className="button" onClick={reset}>
          Reset all
        </button>
      </div>
      {manualUrl && (
        <input
          className="share-url"
          readOnly
          value={manualUrl}
          aria-label="Share link"
          onFocus={(event) => event.currentTarget.select()}
          autoFocus
        />
      )}
      <p className="studio-caption">
        The link updates as you tweak. Shortcuts: 1–5 scenes · C studio · Space play/pause · M mute
        · N/P tracks · V Auto-VJ · F stats · H hide UI.
      </p>
    </Section>
  );
}
