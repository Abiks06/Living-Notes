import { describe, expect, it } from 'vitest';
import { favouriteOf, greetingFor, type Visit } from './greeting';

const DAY = 86_400_000;
/** A Wednesday afternoon, so no weekday line applies. */
const AFTERNOON = new Date(2026, 10, 4, 15);

const visit = (over: Partial<Visit> = {}): Visit => ({
  name: 'Sam',
  now: AFTERNOON,
  sinceLast: DAY,
  visits: 3,
  favourite: '',
  ...over,
});
const always = (value: number) => () => value;

describe('greetingFor', () => {
  it('uses their name', () => {
    expect(greetingFor(visit(), '', always(0))).toContain('Sam');
  });

  it('reads well with no name', () => {
    const line = greetingFor(visit({ name: '' }), '', always(0));
    expect(line).not.toContain(',');
    expect(line.length).toBeGreaterThan(0);
  });

  it('knows what time it is', () => {
    const late = new Date(2026, 10, 4, 2);
    const morning = new Date(2026, 10, 4, 8);
    expect(greetingFor(visit({ now: late }), '', always(0))).toBe('Still up, Sam?');
    expect(greetingFor(visit({ now: morning }), '', always(0))).toBe('Morning, Sam');
  });

  it('notices a long time away', () => {
    expect(greetingFor(visit({ sinceLast: 40 * DAY }), '', always(0))).toBe(
      "It's been a while, Sam",
    );
  });

  it('notices coming straight back', () => {
    expect(greetingFor(visit({ sinceLast: 60_000 }), '', always(0))).toBe('Back already, Sam?');
  });

  it('marks a milestone', () => {
    expect(greetingFor(visit({ visits: 50 }), '', always(0))).toBe('Visit 50, Sam');
  });

  it('knows who they play most', () => {
    expect(greetingFor(visit({ favourite: 'Lana' }), '', always(0))).toBe('More Lana?');
  });

  it('sometimes keeps it simple even on a special day', () => {
    expect(greetingFor(visit({ favourite: 'Lana' }), '', always(0.9))).not.toContain('Lana');
  });

  it('never says the same thing twice running', () => {
    const today = visit({ sinceLast: 40 * DAY });
    let last = '';
    for (let i = 0; i < 200; i++) {
      const line = greetingFor(today, last);
      expect(line).not.toBe(last);
      last = line;
    }
  });

  it('has something to say at every hour of every day', () => {
    for (let hour = 0; hour < 24 * 7; hour++) {
      const now = new Date(2026, 10, 1, hour);
      expect(greetingFor(visit({ now }), '').length).toBeGreaterThan(0);
    }
  });
});

describe('favouriteOf', () => {
  it('waits until there is a real favourite', () => {
    expect(favouriteOf({ Lana: 4 })).toBe('');
    expect(favouriteOf({})).toBe('');
  });

  it('finds the most played', () => {
    expect(favouriteOf({ Lana: 9, Frank: 3 })).toBe('Lana');
  });

  it('calls a tie no favourite', () => {
    expect(favouriteOf({ Lana: 9, Frank: 9 })).toBe('');
  });
});
