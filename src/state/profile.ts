import { create } from 'zustand';
import { sanitizeWord } from '../settings/schema';
import { favouriteOf, greetingFor } from './greeting';
import { isReturning } from './returning';

const STORAGE_KEY = 'resonance.profile';
/** A reload isn't coming back, so each opening of the app only greets once. */
const GREETED_KEY = 'resonance.greeted';
export const MAX_NAME_LENGTH = 20;
const MAX_ARTISTS = 200;

interface Saved {
  name: string;
  /** They've been asked for a name, so it won't be asked again. */
  asked: boolean;
  visits: number;
  lastVisit: number | null;
  lastGreeting: string;
  plays: Record<string, number>;
}

const EMPTY: Saved = {
  name: '',
  asked: false,
  visits: 0,
  lastVisit: null,
  lastGreeting: '',
  plays: {},
};

function load(): Saved {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
    return typeof saved === 'object' && saved !== null ? { ...EMPTY, ...saved } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function save(saved: Saved): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // It still holds for this visit.
  }
}

interface ProfileState extends Saved {
  /** What to say right now, until it has been said. */
  greeting: string | null;
  /** Being spelled by the particles right now. */
  spelling: string | null;
  setName: (name: string) => void;
  skipName: () => void;
  notePlay: (artist: string) => void;
  greeted: () => void;
  spell: (word: string) => void;
  spelled: () => void;
  forget: () => void;
}

export const useProfile = create<ProfileState>()((set, get) => {
  const change = (update: Partial<Saved>) => {
    set(update);
    const { name, asked, visits, lastVisit, lastGreeting, plays } = { ...get(), ...update };
    save({ name, asked, visits, lastVisit, lastGreeting, plays });
  };
  return {
    ...load(),
    greeting: null,
    spelling: null,
    setName: (name) => change({ name: sanitizeWord(name, MAX_NAME_LENGTH), asked: true }),
    skipName: () => change({ asked: true }),
    notePlay: (artist) => {
      if (!artist) return;
      const plays = { ...get().plays, [artist]: (get().plays[artist] ?? 0) + 1 };
      const kept = Object.entries(plays).sort((a, b) => b[1] - a[1]);
      change({ plays: Object.fromEntries(kept.slice(0, MAX_ARTISTS)) });
    },
    greeted: () => set({ greeting: null }),
    spell: (word) => set({ greeting: null, spelling: word }),
    spelled: () => set({ spelling: null }),
    forget: () => {
      change({ ...EMPTY, asked: true });
      set({ greeting: null });
    },
  };
});

function firstOpening(): boolean {
  try {
    if (window.sessionStorage.getItem(GREETED_KEY)) return false;
    window.sessionStorage.setItem(GREETED_KEY, '1');
  } catch {
    // Storage blocked: a reload may greet again, which does no harm.
  }
  return true;
}

/** Counts this visit and, for anyone coming back, works out what to say. */
export function beginVisit(): void {
  if (!firstOpening()) return;
  const profile = useProfile.getState();
  const now = new Date();
  const visits = profile.visits + 1;
  const greeting = isReturning()
    ? greetingFor(
        {
          name: profile.name.trim(),
          now,
          sinceLast: profile.lastVisit === null ? null : now.getTime() - profile.lastVisit,
          visits,
          favourite: favouriteOf(profile.plays),
        },
        profile.lastGreeting,
      )
    : null;
  useProfile.setState({
    visits,
    lastVisit: now.getTime(),
    lastGreeting: greeting ?? profile.lastGreeting,
    greeting,
  });
  const { name, asked, plays } = profile;
  save({
    name,
    asked,
    plays,
    visits,
    lastVisit: now.getTime(),
    lastGreeting: greeting ?? profile.lastGreeting,
  });
}
