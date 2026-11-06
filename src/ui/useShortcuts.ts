import { useEffect } from 'react';
import { audioEngine } from '../audio/AudioEngine';
import { isShortcutKey, ownsSpace } from '../lib/keyboard';
import { useLibrary } from '../library/library';
import { skipNext, skipPrevious, toggleRepeat, toggleShuffle } from '../library/player';
import { SCENES } from '../scene/scenes';
import { APPEARANCES, nextAppearance, useAppearance } from '../settings/appearance';
import { useSettings } from '../settings/settingsStore';
import { jumpSection, setVolume, toggleLiving, toggleMute, togglePlayback } from '../state/actions';
import { useAppStore } from '../state/appStore';

function toggleAuto(): void {
  const settings = useSettings.getState();
  const on = !settings.autoDirector;
  settings.set('autoDirector', on);
  useAppStore.getState().showNotice({
    tone: 'info',
    title: on ? 'Auto on' : 'Auto off',
    body: on ? 'Scenes and colours follow the music.' : 'You’re in control of the scene.',
  });
}

const SEEK_STEP_S = 5;
const VOLUME_STEP = 0.05;

function nudgeTime(by: number): void {
  const transport = audioEngine.transport;
  if (transport) transport.seek(Math.max(0, transport.currentTime() + by));
}

function nudgeVolume(by: number): void {
  const { volume, muted } = useAppStore.getState();
  setVolume(Math.min(1, Math.max(0, (muted ? 0 : volume) + by)));
}

function cycleAppearance(): void {
  const { appearance, setAppearance } = useAppearance.getState();
  const next = nextAppearance(appearance);
  setAppearance(next);
  const chosen = APPEARANCES.find((option) => option.key === next);
  useAppStore
    .getState()
    .showNotice({ tone: 'info', title: chosen?.label ?? next, body: chosen?.hint ?? '' });
}

/** Every single-key shortcut in the app, in one place. */
export function useShortcuts(): void {
  useEffect(() => {
    let spaceHandled = false;
    const onKey = (event: KeyboardEvent) => {
      if (!isShortcutKey(event)) return;
      if (event.code === 'Space') {
        if (ownsSpace(event.target) || !audioEngine.transport) return;
        event.preventDefault();
        spaceHandled = true;
        if (!event.repeat) togglePlayback();
        return;
      }
      // A focused slider already uses the arrow keys for itself.
      const onSlider = (event.target as HTMLInputElement | null)?.type === 'range';
      if (!onSlider && event.key.startsWith('Arrow')) {
        event.preventDefault();
        if (event.key === 'ArrowLeft') nudgeTime(-SEEK_STEP_S);
        if (event.key === 'ArrowRight') nudgeTime(SEEK_STEP_S);
        if (event.key === 'ArrowUp') nudgeVolume(VOLUME_STEP);
        if (event.key === 'ArrowDown') nudgeVolume(-VOLUME_STEP);
        return;
      }
      const scene = SCENES[Number(event.key) - 1];
      if (scene) {
        const settings = useSettings.getState();
        settings.set('autoDirector', false);
        settings.set('scene', scene.key);
        return;
      }
      switch (event.key.toLowerCase()) {
        case 'm':
          toggleMute();
          break;
        case 'n':
          skipNext();
          break;
        case 'p':
          skipPrevious();
          break;
        case 's':
          toggleShuffle();
          break;
        case 'r':
          toggleRepeat();
          break;
        case ']':
          jumpSection(1);
          break;
        case '[':
          jumpSection(-1);
          break;
        case 'q':
          useLibrary.getState().setOpen(!useLibrary.getState().open);
          break;
        case 'b':
          toggleLiving();
          break;
        case 'c':
          useAppStore.getState().setStudioOpen(!useAppStore.getState().studioOpen);
          break;
        case 'v':
          toggleAuto();
          break;
        case 't':
          cycleAppearance();
          break;
      }
    };
    // Firefox activates a focused button on keyup, so that has to be cancelled too.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !spaceHandled) return;
      spaceHandled = false;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);
}
