import { type CSSProperties, useEffect, useState } from 'react';
import { isShortcutKey } from '../lib/keyboard';
import { recordingSupport } from '../recording/clipRecorder';
import { startRecording, stopRecording } from '../recording/recordingActions';
import { useSettings } from '../settings/settingsStore';
import { toggleLiving } from '../state/actions';
import { useAppStore } from '../state/appStore';
import { CollapseIcon, ExpandIcon, MoonIcon, RecordIcon, SlidersIcon, StopIcon } from './icons';
import { STUDIO_TOGGLE_ID } from './studio/studioIds';

const RECORDING = recordingSupport();

function RecordButton() {
  const recording = useAppStore((state) => state.recording);
  const seconds = useAppStore((state) => state.capture.seconds);

  if (recording.state === 'recording') {
    const remaining = Math.max(0, Math.ceil(recording.seconds - recording.elapsed));
    return (
      <button
        type="button"
        className="pill record-button is-recording"
        style={{ '--progress': recording.elapsed / recording.seconds } as CSSProperties}
        aria-label={`Recording, ${remaining} seconds left. Stop and save now.`}
        onClick={stopRecording}
      >
        <span className="record-button__dot" aria-hidden="true" />
        <span className="record-button__label">REC</span>
        <span className="record-button__time">0:{String(remaining).padStart(2, '0')}</span>
        <StopIcon width={14} height={14} />
      </button>
    );
  }

  return (
    <button
      type="button"
      className="pill record-button"
      disabled={!RECORDING.ok}
      title={RECORDING.ok ? `Record a ${seconds}-second clip with sound` : RECORDING.reason}
      onClick={startRecording}
    >
      <RecordIcon width={14} height={14} />
      <span className="pill__label">Record {seconds}s</span>
    </button>
  );
}

type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
};
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

const doc = document as FullscreenDocument;
// iPhone Safari only allows fullscreen video, so the button is hidden there.
const FULLSCREEN = Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);

function FullscreenButton() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sync = () => setActive(Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  if (!FULLSCREEN) return null;

  const toggle = () => {
    const root = document.documentElement as FullscreenElement;
    if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
      void (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())?.catch(() => undefined);
    } else {
      void (root.requestFullscreen?.() ?? root.webkitRequestFullscreen?.())?.catch(() => undefined);
    }
  };

  return (
    <button
      type="button"
      className="pill pill--icon"
      aria-label={active ? 'Exit fullscreen' : 'Fullscreen'}
      title={active ? 'Exit fullscreen' : 'Fullscreen'}
      onClick={toggle}
    >
      {active ? <CollapseIcon /> : <ExpandIcon />}
    </button>
  );
}

function setFullscreen(on: boolean): void {
  const root = document.documentElement as FullscreenElement;
  const active = Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
  if (on === active || !FULLSCREEN) return;
  if (on)
    void (root.requestFullscreen?.() ?? root.webkitRequestFullscreen?.())?.catch(() => undefined);
  else void (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())?.catch(() => undefined);
}

function toggleLounge(): void {
  const store = useAppStore.getState();
  const on = !store.lounge;
  store.setLounge(on);
  setFullscreen(on);
  if (on) {
    store.showNotice({
      tone: 'info',
      title: 'Lounge mode',
      body: 'The screen is now a mood light. Press L or Esc to come back.',
    });
  }
}

function LoungeToggle() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === 'l' || event.key === 'L') && isShortcutKey(event)) toggleLounge();
    };
    // The browser's own Esc leaves fullscreen without a keydown reaching the page.
    const onFullscreen = () => {
      const active = Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
      const store = useAppStore.getState();
      if (!active && store.lounge) store.setLounge(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('webkitfullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('webkitfullscreenchange', onFullscreen);
    };
  }, []);

  return (
    <button
      type="button"
      className="pill pill--icon"
      aria-label="Lounge mode"
      title="Lounge mode (L)"
      onClick={toggleLounge}
    >
      <MoonIcon />
    </button>
  );
}

function StudioToggle() {
  const open = useAppStore((state) => state.studioOpen);
  const setOpen = useAppStore((state) => state.setStudioOpen);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isShortcutKey(event)) return;
      if (event.key === 'b' || event.key === 'B') toggleLiving();
      if (event.key === 'c' || event.key === 'C') {
        setOpen(!useAppStore.getState().studioOpen);
      }
      if (event.key === 'v' || event.key === 'V') {
        const settings = useSettings.getState();
        const on = !settings.autoDirector;
        settings.set('autoDirector', on);
        useAppStore.getState().showNotice({
          tone: 'info',
          title: on ? 'Auto-VJ on' : 'Auto-VJ off',
          body: on
            ? 'Scenes and palettes now follow the music. Press V to take over.'
            : 'You’re back in control.',
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  return (
    <button
      id={STUDIO_TOGGLE_ID}
      type="button"
      className="pill studio-toggle"
      aria-expanded={open}
      aria-controls="studio"
      onClick={() => setOpen(!open)}
    >
      <SlidersIcon />
      <span className="pill__label">Studio</span>
    </button>
  );
}

/** Top-right toolbar: record, lounge, fullscreen, studio. */
export function TopActions() {
  return (
    <div className="top-actions chrome">
      <RecordButton />
      <LoungeToggle />
      <FullscreenButton />
      <StudioToggle />
    </div>
  );
}
