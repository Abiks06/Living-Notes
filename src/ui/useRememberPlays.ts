import { useEffect } from 'react';
import { useLibrary } from '../library/library';
import { useAppStore } from '../state/appStore';
import { useProfile } from '../state/profile';

/** Keeps count of who's played, for the app to mention one day. */
export function useRememberPlays(): void {
  const notePlay = useProfile((state) => state.notePlay);
  const local = useLibrary((state) => state.nowPlaying);
  const live = useAppStore((state) => state.liveSong);
  const key = live?.key ?? local?.id ?? null;
  useEffect(() => {
    if (key) notePlay(live?.artist ?? local?.artist ?? '');
    // Once per song, not each time more is learned about it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
