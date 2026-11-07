const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface Visit {
  name: string;
  now: Date;
  /** Since the last time the app was opened, or null on the first. */
  sinceLast: number | null;
  /** Counting this one. */
  visits: number;
  /** Who they've played most, once there's a clear favourite. */
  favourite: string;
}

const MILESTONES = new Set([10, 25, 50, 100, 250, 500, 1000]);

/** Lines that only make sense today. When one fits, it's more personal than the time of day. */
function moments({ name, now, sinceLast, visits, favourite }: Visit): string[] {
  const you = name ? `, ${name}` : '';
  const lines: string[] = [];
  if (MILESTONES.has(visits)) lines.push(`Visit ${visits}${you}`);
  if (sinceLast !== null && sinceLast >= 30 * DAY) {
    lines.push(`It's been a while${you}`, `Look who's back${you}`);
  } else if (sinceLast !== null && sinceLast >= 7 * DAY) {
    lines.push(name ? `Missed you, ${name}` : 'Missed you', `Good to see you${you}`);
  } else if (sinceLast !== null && sinceLast < HOUR) {
    lines.push(`Back already${you}?`, name ? `One more, ${name}?` : 'One more?');
  }
  const hour = now.getHours();
  if (now.getDay() === 5 && hour >= 17) lines.push(`It's Friday${you}`);
  if (now.getDay() === 0 && hour < 13) lines.push(`Slow Sunday${you}?`);
  if (favourite) lines.push(`More ${favourite}?`);
  return lines;
}

function timeOfDay({ name, now }: Visit): string[] {
  const you = name ? `, ${name}` : '';
  const hour = now.getHours();
  if (hour < 5) return [`Still up${you}?`, `Late one${you}`, `Just us now${you}`];
  if (hour < 12) return [`Morning${you}`, `Fresh start${you}`, `Good morning${you}`];
  if (hour < 17) return [`Afternoon${you}`, `Good to see you${you}`, `Hey${you}`];
  if (hour < 22) return [`Evening${you}`, `Welcome back${you}`, `Good evening${you}`];
  return [`Winding down${you}?`, `Welcome back${you}`, `Night session${you}?`];
}

/**
 * What to say when someone comes back. Worked out here on the device from what the app already
 * remembers, and never the same twice in a row.
 */
export function greetingFor(visit: Visit, last: string, random = Math.random): string {
  const special = moments(visit).filter((line) => line !== last);
  // Mostly a line about today, but not every time, or they'd stop feeling like a surprise.
  const useSpecial = special.length > 0 && random() < 0.7;
  const pool = useSpecial ? special : timeOfDay(visit).filter((line) => line !== last);
  return (
    pool[Math.floor(random() * pool.length)] ?? `Welcome back${visit.name ? `, ${visit.name}` : ''}`
  );
}

/** Plays before someone counts as a favourite, and how far ahead of the rest they have to be. */
const FAVOURITE_PLAYS = 5;

export function favouriteOf(plays: Readonly<Record<string, number>>): string {
  const [first, second] = Object.entries(plays).sort((a, b) => b[1] - a[1]);
  if (!first || first[1] < FAVOURITE_PLAYS) return '';
  return !second || first[1] > second[1] ? first[0] : '';
}
