import { useEffect, useRef, useState } from 'react';
import { useLibrary } from '../library/library';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useAppStore } from '../state/appStore';
import { MAX_NAME_LENGTH, useProfile } from '../state/profile';
import { isReturning } from '../state/returning';

/** How long particles get to spell it before it's written out instead. */
const PARTICLES_WAIT_MS = 3500;
const SHOWN_MS = 5000;
const NAME_AFTER_MS = 8000;

/**
 * The greeting, in words. Normally the particles spell it, and this only steps in where they
 * can't: motion turned off, or a GPU that isn't ready yet.
 */
export function Greeting() {
  const greeting = useProfile((state) => state.greeting);
  const spelling = useProfile((state) => state.spelling);
  const greeted = useProfile((state) => state.greeted);
  const calm = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [written, setWritten] = useState(false);
  const reopen = useRef(false);

  useEffect(() => {
    if (!greeting) {
      setWritten(false);
      return;
    }
    const write = window.setTimeout(() => setWritten(true), calm ? 0 : PARTICLES_WAIT_MS);
    const end = window.setTimeout(greeted, (calm ? 0 : PARTICLES_WAIT_MS) + SHOWN_MS);
    return () => {
      window.clearTimeout(write);
      window.clearTimeout(end);
    };
  }, [greeting, calm, greeted]);

  // The word is spelled across the middle of the window, so the library steps aside for it.
  useEffect(() => {
    const library = useLibrary.getState();
    if (spelling) {
      reopen.current = library.open;
      library.setOpen(false);
    } else if (reopen.current) {
      reopen.current = false;
      library.setOpen(true);
    }
  }, [spelling]);

  if (!greeting || !written) return null;
  return (
    <p className="greeting" role="status">
      {greeting}
    </p>
  );
}

/** Asked once, on a later visit: the first one is for the music. */
export function NameCard() {
  const asked = useProfile((state) => state.asked);
  const name = useProfile((state) => state.name);
  const setName = useProfile((state) => state.setName);
  const skipName = useProfile((state) => state.skipName);
  const phase = useAppStore((state) => state.phase);
  const [due, setDue] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (asked || name || phase !== 'running' || !isReturning()) return;
    const timer = window.setTimeout(() => setDue(true), NAME_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [asked, name, phase]);

  if (!due || asked || name) return null;
  return (
    <form
      className="name-card"
      aria-label="Your name"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.trim()) setName(draft);
      }}
    >
      <label className="name-card__label" htmlFor="name-card-input">
        What should Resonance call you?
      </label>
      <input
        id="name-card-input"
        className="name-card__input"
        value={draft}
        maxLength={MAX_NAME_LENGTH}
        autoComplete="given-name"
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="name-card__actions">
        <button type="submit" className="name-card__save" disabled={!draft.trim()}>
          Save
        </button>
        <button type="button" className="name-card__skip" onClick={skipName}>
          Not now
        </button>
      </div>
      <p className="name-card__note">Kept on this device only.</p>
    </form>
  );
}
