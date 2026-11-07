import { useEffect, useState } from 'react';
import { lineAt, type LyricLine } from '../lyrics/lrc';
import { currentSong, songTime, useLyrics } from '../lyrics/lyrics';
import { useAppStore } from '../state/appStore';
import { useProfile } from '../state/profile';
import { isReturning } from '../state/returning';

/** Past the title card, so the two don't compete. */
const OFFER_AFTER_MS = 9000;

/** Full lyrics: each line as it's sung, and nothing at all in the instrumental stretches. */
export function LyricsLine() {
  const mode = useLyrics((state) => state.mode);
  const lines = useLyrics((state) => state.lines);
  const [line, setLine] = useState<LyricLine | null>(null);

  useEffect(() => {
    if (mode !== 'full' || lines.length === 0) {
      setLine(null);
      return;
    }
    let frame = 0;
    const check = () => {
      const time = songTime();
      // Only a change reaches React, which is a few times a minute.
      setLine(time === null ? null : lineAt(lines, time));
      frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, [mode, lines]);

  if (!line) return null;
  return (
    <p key={line.time} className="lyric-line">
      {line.text}
    </p>
  );
}

/** Asked once. It's the app's one feature that sends anything out, so it doesn't just start. */
export function LyricsOffer() {
  const offered = useLyrics((state) => state.offered);
  const setMode = useLyrics((state) => state.setMode);
  const setOffered = useLyrics((state) => state.setOffered);
  const source = useAppStore((state) => state.source);
  // The name card sits in the same place, and only one should ask at a time.
  const nameFirst = useProfile((state) => !state.asked && !state.name) && isReturning();
  const [due, setDue] = useState(false);

  useEffect(() => {
    if (offered || !currentSong()) return;
    const timer = window.setTimeout(() => setDue(true), OFFER_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [offered, source]);

  if (!due || offered || nameFirst) return null;
  return (
    <section className="name-card" aria-label="Lyrics">
      <p className="name-card__label">Weave this song’s lyrics into the visuals?</p>
      <div className="name-card__actions">
        <button type="button" className="name-card__save" onClick={() => setMode('moments')}>
          Yes
        </button>
        <button type="button" className="name-card__skip" onClick={setOffered}>
          Not now
        </button>
      </div>
      <p className="name-card__note">
        Song names are looked up on LRCLIB, a free lyrics service. Your music never leaves this
        device.
      </p>
    </section>
  );
}
