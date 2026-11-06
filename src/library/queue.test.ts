import { describe, expect, it } from 'vitest';
import {
  addToQueue,
  advance,
  cycleRepeat,
  EMPTY_QUEUE,
  goBack,
  peekNext,
  playFrom,
  playNext,
  removeFromQueue,
  setShuffle,
  syncQueue,
  upcoming,
} from './queue';

const songs = ['a', 'b', 'c', 'd', 'e'];
const seeded = () => {
  let seed = 42;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
};

describe('Play queue', () => {
  it('plays in order from a chosen song', () => {
    let queue = playFrom(EMPTY_QUEUE, songs, 'c');
    expect(queue.current).toBe('c');
    expect(peekNext(queue)).toBe('d');
    queue = advance(queue, false);
    expect(queue.current).toBe('d');
  });

  it('wraps on repeat all and stops with repeat off', () => {
    const looping = { ...playFrom(EMPTY_QUEUE, songs, 'e'), repeat: 'all' as const };
    expect(advance(looping, false).current).toBe('a');
    const stopping = { ...looping, repeat: 'off' as const };
    expect(peekNext(stopping)).toBe(null);
    expect(advance(stopping, false).current).toBe(null);
  });

  it('repeats one song when it ends, but a skip still moves on', () => {
    const queue = { ...playFrom(EMPTY_QUEUE, songs, 'b'), repeat: 'one' as const };
    expect(advance(queue, false).current).toBe('b');
    expect(advance(queue, true).current).toBe('c');
  });

  it('puts play next ahead of the list, and the queue after it', () => {
    let queue = playFrom(EMPTY_QUEUE, songs, 'a');
    queue = addToQueue(queue, 'e');
    queue = playNext(queue, 'd');
    expect(upcoming(queue, 3)).toEqual(['d', 'e', 'b']);
    queue = advance(queue, false);
    expect(queue.current).toBe('d');
    queue = advance(queue, false);
    expect(queue.current).toBe('e');
    queue = advance(queue, false);
    expect(queue.current).toBe('b');
  });

  it('doesn’t list a song twice in the queue', () => {
    const queue = addToQueue(addToQueue(playFrom(EMPTY_QUEUE, songs, 'a'), 'c'), 'c');
    expect(queue.upNext).toEqual(['c']);
  });

  it('removes a queued song', () => {
    const queue = addToQueue(addToQueue(playFrom(EMPTY_QUEUE, songs, 'a'), 'c'), 'd');
    expect(removeFromQueue(queue, 0).upNext).toEqual(['d']);
  });

  it('goes back through what actually played', () => {
    let queue = playFrom(EMPTY_QUEUE, songs, 'a');
    queue = playNext(queue, 'e');
    queue = advance(queue, false);
    queue = advance(queue, false);
    expect(queue.current).toBe('b');
    queue = goBack(queue);
    expect(queue.current).toBe('e');
    queue = goBack(queue);
    expect(queue.current).toBe('a');
  });

  it('shuffles every song exactly once, keeping the one that’s playing', () => {
    let queue = playFrom(EMPTY_QUEUE, songs, 'c');
    queue = setShuffle(queue, true, seeded());
    expect(queue.current).toBe('c');
    expect(queue.order[queue.index]).toBe('c');
    expect([...queue.order].sort()).toEqual(songs);
    queue = setShuffle(queue, false);
    expect(queue.order).toEqual(songs);
    expect(queue.index).toBe(2);
  });

  it('reshuffles each time round without repeating the last song', () => {
    const random = seeded();
    let queue = setShuffle(playFrom(EMPTY_QUEUE, songs, 'a'), true, random);
    for (let round = 0; round < 30; round++) {
      for (let i = 0; i < songs.length - 1; i++) queue = advance(queue, false, random);
      const last = queue.current;
      queue = advance(queue, false, random);
      expect(queue.current).not.toBe(last);
      expect([...queue.order].sort()).toEqual(songs);
    }
  });

  it('drops deleted songs from the queue but lets the one playing finish', () => {
    let queue = addToQueue(playFrom(EMPTY_QUEUE, songs, 'b'), 'e');
    queue = syncQueue(queue, [], ['b', 'c', 'e']);
    expect(queue.current).toBe('b');
    expect(queue.order).not.toContain('c');
    expect(queue.upNext).toEqual([]);
    expect(peekNext(queue)).toBe('d');
  });

  it('adds new songs to the end without disturbing what plays next', () => {
    const queue = syncQueue(playFrom(EMPTY_QUEUE, songs, 'b'), ['z'], []);
    expect(queue.order.at(-1)).toBe('z');
    expect(queue.current).toBe('b');
    expect(peekNext(queue)).toBe('c');
  });

  it('never queues a song twice when the one playing is deleted and restored', () => {
    const queue = syncQueue(playFrom(EMPTY_QUEUE, songs, 'b'), ['b'], []);
    expect(queue.order.filter((id) => id === 'b')).toHaveLength(1);
  });

  it('cycles repeat', () => {
    expect(EMPTY_QUEUE.repeat).toBe('off');
    const all = cycleRepeat(EMPTY_QUEUE);
    expect(all.repeat).toBe('all');
    expect(cycleRepeat(all).repeat).toBe('one');
    expect(cycleRepeat(cycleRepeat(all)).repeat).toBe('off');
  });
});
