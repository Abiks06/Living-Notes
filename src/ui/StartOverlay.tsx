import { useState } from 'react';
import {
  addFolderFiles,
  canRememberFolder,
  pickFolder,
  reopenFolder,
  useLibrary,
} from '../library/library';
import { ensureStarted, startExperience } from '../state/actions';
import { useAppStore } from '../state/appStore';

/** The first screen: one thing to do, and the living cloud behind it. */
export function StartOverlay() {
  const phase = useAppStore((state) => state.phase);
  const saved = useLibrary((state) => state.saved);
  // Already back without asking: the app, or a browser told to allow it on every visit.
  const restored = useLibrary((state) => state.folder);
  const [problem, setProblem] = useState('');
  if (phase !== 'intro') return null;

  const enter = () => {
    if (!ensureStarted()) return false;
    useLibrary.getState().setOpen(true);
    return true;
  };
  const failed = () => setProblem('That folder couldn’t be opened.');

  const open = () => {
    setProblem('');
    if (restored) {
      enter();
      return;
    }
    // Asked for first: the browser only allows it straight from the click.
    if (saved) {
      const opening = reopenFolder();
      enter();
      opening.catch(failed);
      return;
    }
    if (!canRememberFolder()) {
      document.querySelector<HTMLInputElement>('#start-folder')?.click();
      return;
    }
    pickFolder()
      .then((picked) => {
        if (picked) enter();
      })
      .catch(failed);
  };

  return (
    <div className="start">
      <h1 className="start__title">Resonance</h1>
      <p className="start__line">Your music, alive.</p>
      <button type="button" className="start__open" autoFocus onClick={open}>
        {(restored ?? saved) ? `Open ${restored ?? saved}` : 'Open your music folder'}
      </button>
      <button type="button" className="start__demo" onClick={() => startExperience()}>
        Try a demo
      </button>
      <p className="start__note" role={problem ? 'alert' : undefined}>
        {problem || 'Your music stays on this device.'}
      </p>
      <input
        id="start-folder"
        type="file"
        hidden
        multiple
        // A non-standard attribute, but every browser supports it.
        {...{ webkitdirectory: '' }}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length > 0 && enter()) void addFolderFiles(files);
        }}
      />
    </div>
  );
}
