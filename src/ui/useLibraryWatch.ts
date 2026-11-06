import { useEffect } from 'react';
import { refreshLibrary, type FolderChanges } from '../library/library';
import { useAppStore } from '../state/appStore';

/** A folder can't announce its changes everywhere, so it's looked at again this often. */
const CHECK_EVERY_MS = 15_000;

function describeChanges({ added, removed }: FolderChanges): string {
  const songs = (count: number) => `${count} ${count === 1 ? 'song' : 'songs'}`;
  if (added > 0 && removed > 0) return `${songs(added)} added, ${songs(removed)} removed`;
  return added > 0 ? `${songs(added)} added` : `${songs(removed)} removed`;
}

/** Looks for changes. Asked for by hand, it also says when there were none. */
export async function checkForNewSongs(asked = false): Promise<void> {
  const changes = await refreshLibrary();
  const changed = changes.added > 0 || changes.removed > 0;
  if (!changed && !asked) return;
  useAppStore.getState().showNotice({
    tone: 'info',
    title: changed ? describeChanges(changes) : 'Your library is up to date',
    body: '',
  });
}

/** Keeps the library in step with the folder: on coming back to the app, and while it's open. */
export function useLibraryWatch(): void {
  useEffect(() => {
    const check = () => {
      if (!document.hidden) void checkForNewSongs();
    };
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
}
