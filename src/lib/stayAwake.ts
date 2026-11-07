import { audioFeatures } from '../audio/features';
import { useAppStore } from '../state/appStore';
import { AwakeRule } from './awakeRule';

const CHECK_S = 5;
/** The same line the rest of the app draws between sound and silence. */
const HEARD_GATE = 0.3;

interface ScreenLock {
  released: boolean;
  release: () => Promise<void>;
}

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<ScreenLock> };
};

/** The Windows app asks Windows directly. A browser has its own way, and drops it when hidden. */
function webLock(): (on: boolean) => void {
  let lock: ScreenLock | null = null;
  let asking = false;
  return (on) => {
    if (!on) {
      void lock?.release().catch(() => undefined);
      lock = null;
      return;
    }
    if (asking || (lock && !lock.released) || document.visibilityState !== 'visible') return;
    asking = true;
    void (navigator as WakeLockNavigator).wakeLock
      ?.request('screen')
      .then((granted) => (lock = granted))
      .catch(() => undefined)
      .finally(() => (asking = false));
  };
}

function isHearing(): boolean {
  const { source, paused } = useAppStore.getState();
  return source !== null && !paused && audioFeatures.gate > HEARD_GATE;
}

/** Keeps the screen and PC awake while fullscreen visuals are playing. Returns a way to stop. */
export function startStayingAwake(): () => void {
  const rule = new AwakeRule();
  const desktop = window.resonanceDesktop?.keepAwake;
  const hold = desktop ?? webLock();
  let held = false;

  const timer = window.setInterval(() => {
    const on = rule.update(CHECK_S, document.fullscreenElement !== null, isHearing());
    // The browser's lock needs renewing after the page has been hidden, so it's asked every time.
    if (on !== held || (on && !desktop)) hold(on);
    held = on;
  }, CHECK_S * 1000);

  return () => {
    window.clearInterval(timer);
    if (held) hold(false);
  };
}
