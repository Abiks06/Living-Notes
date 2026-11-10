import { useState } from 'react';
import { IS_DESKTOP, offersWindowsApp, WINDOWS_APP_URL } from '../lib/desktop';
import {
  addFolderFiles,
  canRememberFolder,
  pickFolder,
  reopenFolder,
  useLibrary,
} from '../library/library';
import { ensureStarted, startExperience } from '../state/actions';
import { useAppStore } from '../state/appStore';

const WINDOWS_APP = offersWindowsApp(navigator.userAgent, IS_DESKTOP);

/** The first screen: one thing to do, and the living cloud behind it. */
export function StartOverlay() {
  const phase = useAppStore((state) => state.phase);
  const saved = useLibrary((state) => state.saved);
  // Back with permission still in place, the folder is already open and its songs are loaded.
  const ready = useLibrary((state) => (state.tracks.length > 0 ? state.folder : null));
  const count = useLibrary((state) => state.tracks.length);
  const [problem, setProblem] = useState('');
  if (phase !== 'intro') return null;

  const enter = () => {
    if (!ensureStarted()) return false;
    useLibrary.getState().setOpen(true);
    return true;
  };
  const failed = () => setProblem('That folder couldn’t be opened.');

  const choose = () => {
    setProblem('');
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

  const open = () => {
    setProblem('');
    if (ready) {
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
    choose();
  };

  const known = ready ?? saved;

  return (
    <div className="start">
      <h1 className="start__title">Living Notes</h1>
      <p className="start__line">Your music, alive.</p>
      <button type="button" className="start__open" autoFocus onClick={open}>
        {known ? `Open ${known}` : 'Open your music folder'}
      </button>
      <button type="button" className="start__demo" onClick={() => startExperience()}>
        Try a demo
      </button>
      {known && (
        <button type="button" className="start__demo" onClick={choose}>
          Choose another folder
        </button>
      )}
      <p className="start__note" role={problem ? 'alert' : undefined}>
        {problem ||
          (ready
            ? `${count} ${count === 1 ? 'song' : 'songs'} ready · Your music stays on this device.`
            : 'Your music stays on this device.')}
      </p>
      {WINDOWS_APP && (
        <a
          className="start__app"
          href={WINDOWS_APP_URL}
          rel="noreferrer"
          title="Free. It can also hear anything playing on this PC. Windows may warn you the first time, because the app is new."
        >
          Get the Windows app
        </a>
      )}
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
