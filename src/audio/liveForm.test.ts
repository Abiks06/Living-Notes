import { describe, expect, it } from 'vitest';
import { LiveForm } from './liveForm';

const DT = 1 / 60;

interface Moment {
  low: number;
  rest?: number;
  kick?: boolean;
  gate?: number;
}

/** Plays a stretch of made-up song, and says when the form called a drop. */
function play(form: LiveForm, from: number, to: number, at: (time: number) => Moment): number[] {
  const levels = new Float32Array(6);
  const drops: number[] = [];
  let before = form.impact;
  for (let frame = Math.round(from / DT); frame < Math.round(to / DT); frame++) {
    const time = frame * DT;
    const moment = at(time);
    levels.fill(moment.rest ?? 0.45);
    levels[0] = levels[1] = moment.low;
    form.update(levels, moment.kick ?? false, moment.gate ?? 1, DT);
    if (form.impact > before) drops.push(time);
    before = form.impact;
  }
  return drops;
}

/** A kick twice a second, on the frame it falls on. */
const onBeat = (time: number) => Math.round(time / DT) % 30 === 0;

const full = (time: number): Moment => ({ low: 0.7, rest: 0.5, kick: onBeat(time) });
const breakdown = (): Moment => ({ low: 0.35, rest: 0.4 });

describe('LiveForm', () => {
  it('calls a drop when the low end comes back on a kick', () => {
    const form = new LiveForm();
    expect(play(form, 0, 20, full)).toEqual([]);
    expect(play(form, 20, 30, breakdown)).toEqual([]);

    const drops = play(form, 30, 32, full);

    expect(drops).toHaveLength(1);
    expect(drops[0]).toBeLessThan(30.2);
    expect(form.dropPower).toBeGreaterThanOrEqual(0.6);
    expect(form.world).toBeGreaterThan(0.5);
    expect(form.presence).toBeGreaterThan(0.7);
  });

  it('hits harder for a bigger drop', () => {
    const land = (low: number) => {
      const form = new LiveForm();
      play(form, 0, 20, () => ({ low: 0.6, rest: 0.5 }));
      play(form, 20, 30, () => ({ low, rest: 0.4 }));
      play(form, 30, 31, full);
      return form.dropPower;
    };

    expect(land(0.3)).toBeGreaterThan(land(0.5));
  });

  it("doesn't call a drop without a kick", () => {
    const form = new LiveForm();
    play(form, 0, 20, full);
    play(form, 20, 30, breakdown);

    expect(play(form, 30, 32, () => ({ low: 0.7, rest: 0.5 }))).toEqual([]);
  });

  it("doesn't take sparse kicks for drops, however quiet the gaps", () => {
    const form = new LiveForm();
    const sparse = (time: number): Moment => {
      const hit = time % 2 < 0.12;
      return { low: hit ? 0.7 : 0.3, rest: hit ? 0.5 : 0.4, kick: hit };
    };

    expect(play(form, 0, 90, sparse)).toEqual([]);
  });

  it('never calls one in a song that stays level', () => {
    const form = new LiveForm();

    expect(play(form, 0, 90, full)).toEqual([]);
    expect(form.tension).toBe(0);
  });

  it('waits before calling a second drop', () => {
    const form = new LiveForm();
    play(form, 0, 20, full);
    play(form, 20, 30, breakdown);
    play(form, 30, 33, full);
    play(form, 33, 36, () => ({ low: 0.3, rest: 0.4 }));

    expect(play(form, 36, 38, full)).toEqual([]);
  });

  it('feels the climb out of a breakdown, and lets go once the drop lands', () => {
    const form = new LiveForm();
    play(form, 0, 20, full);
    play(form, 20, 30, breakdown);
    expect(form.tension).toBeLessThan(0.1);

    play(form, 30, 40, (time) => {
      const climb = (time - 30) / 10;
      return { low: 0.35 + climb * 0.1, rest: 0.4 + climb * 0.35 };
    });
    expect(form.tension).toBeGreaterThan(0.3);

    play(form, 40, 41.5, full);
    expect(form.tension).toBeLessThan(0.4);
  });

  it("doesn't take the sound still rising after a drop for another climb", () => {
    const form = new LiveForm();
    play(form, 0, 20, full);
    play(form, 20, 30, breakdown);

    let highest = 0;
    for (let time = 30; time < 36; time += 0.5) {
      play(form, time, time + 0.5, (now) => ({ ...full(now), rest: 0.4 + (now - 30) * 0.05 }));
      highest = Math.max(highest, form.tension);
    }

    expect(highest).toBeLessThan(0.1);
  });

  it('ends the bigger section when the sound falls away', () => {
    const form = new LiveForm();
    play(form, 0, 20, full);
    play(form, 20, 30, breakdown);
    play(form, 30, 34, full);
    expect(form.world).toBeGreaterThan(0.5);

    play(form, 34, 40, breakdown);

    expect(form.world).toBeLessThan(0.05);
  });

  it('follows how big the moment is against the song so far', () => {
    const form = new LiveForm();
    play(form, 0, 30, full);
    const big = form.presence;

    play(form, 30, 45, breakdown);

    expect(form.presence).toBeLessThan(big - 0.4);
  });

  it('assumes the upper half until it has heard enough', () => {
    const form = new LiveForm();

    play(form, 0, 0.5, breakdown);

    expect(form.presence).toBeGreaterThan(0.6);
  });

  it("doesn't count silence as part of the song", () => {
    const form = new LiveForm();
    play(form, 0, 20, () => ({ low: 0, rest: 0, gate: 0 }));
    play(form, 20, 22, breakdown);

    // Twenty seconds of nothing can't have used up the wait at the start of a song.
    expect(play(form, 22, 24, full)).toEqual([]);
  });

  it('forgets the song on reset', () => {
    const form = new LiveForm();
    play(form, 0, 20, full);
    play(form, 20, 30, breakdown);
    play(form, 30, 31, full);

    form.reset();

    expect(form.impact).toBe(0);
    expect(form.world).toBe(0);
    expect(form.dropPower).toBe(1);
    expect(form.presence).toBeCloseTo(0.7);
    play(form, 0, 3, breakdown);
    expect(play(form, 3, 5, full)).toEqual([]);
  });
});
