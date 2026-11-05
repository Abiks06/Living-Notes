import { useEffect, useState } from 'react';
import { artFor } from '../library/art';
import { type Track, useLibrary } from '../library/library';
import { useAppStore } from '../state/appStore';

/** Long enough to read twice, short enough to be gone before the song has really started. */
const SHOWN_MS = 7000;
const LEAVING_MS = 900;

/** Album and year, with whichever the file doesn't have left out. */
function detail(track: Track): string {
  return [track.album, track.year].filter(Boolean).join(' · ');
}

/**
 * The song's name, set large over the picture as it starts, like a film's title card. It belongs
 * to the show rather than the controls, so it stays when they fade away.
 */
export function TitleCard() {
  const track = useLibrary((state) => state.nowPlaying);
  const comingUp = useLibrary((state) => state.comingUp);
  const hidden = useAppStore((state) => state.uiHiddenManual);
  const [phase, setPhase] = useState<'in' | 'out' | 'gone'>('gone');
  const [art, setArt] = useState<string | null>(null);

  useEffect(() => {
    if (!track) {
      setPhase('gone');
      return;
    }
    let live = true;
    setPhase('in');
    setArt(null);
    void artFor(track, true).then((url) => {
      if (live) setArt(url);
    });
    const leave = window.setTimeout(() => setPhase('out'), SHOWN_MS);
    const gone = window.setTimeout(() => setPhase('gone'), SHOWN_MS + LEAVING_MS);
    return () => {
      live = false;
      window.clearTimeout(leave);
      window.clearTimeout(gone);
    };
  }, [track]);

  if (hidden) return null;
  return (
    <>
      {track && phase !== 'gone' && (
        <div className="title-card" data-phase={phase} key={track.id} aria-hidden="true">
          {art && <img className="title-card__art" src={art} alt="" />}
          <div className="title-card__words">
            <p className="title-card__title">{track.title}</p>
            <p className="title-card__artist">{track.artist}</p>
            {detail(track) && <p className="title-card__detail">{detail(track)}</p>}
          </div>
        </div>
      )}
      {comingUp && (
        <p className="coming-up" aria-hidden="true">
          <span className="coming-up__label">Up next</span>
          <span className="coming-up__song">
            {comingUp.title} · {comingUp.artist}
          </span>
        </p>
      )}
    </>
  );
}
