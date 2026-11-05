import { useEffect } from 'react';
import { audioEngine } from '../audio/AudioEngine';
import { isShortcutKey, ownsSpace } from '../lib/keyboard';
import { useLibrary } from '../library/library';
import { skipNext, skipPrevious, toggleRepeat, toggleShuffle } from '../library/player';
import { SCENES } from '../scene/scenes';
import { useSettings } from '../settings/settingsStore';
import { jumpSection, toggleLiving, toggleMute, togglePlayback } from '../state/actions';
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
