export type Repeat = 'off' | 'all' | 'one';

/** The state of play: pure data, so every rule here can be tested without any audio. */
export interface PlayQueue {
  /** Track ids in the order they'll play. */
  readonly order: readonly string[];
  /** The same ids as chosen, to come back to when shuffle goes off. */
  readonly base: readonly string[];
  /** Where in `order` the song playing now is; -1 before anything has played. */
  readonly index: number;
  /** "Play next" and "Add to queue" picks, which go ahead of everything else. */
  readonly upNext: readonly string[];
  /** Picks played so far, so previous can walk back through them. */
  readonly history: readonly string[];
  readonly current: string | null;
  readonly shuffle: boolean;
  readonly repeat: Repeat;
}

export const EMPTY_QUEUE: PlayQueue = {
  order: [],
  base: [],
  index: -1,
  upNext: [],
  history: [],
  current: null,
  shuffle: false,
  repeat: 'off',
};

const MAX_HISTORY = 200;

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

/** Starts a set of tracks, from one of them or from the top. */
export function playFrom(
  queue: PlayQueue,
  ids: readonly string[],
  start: string | null,
  random: () => number = Math.random,
): PlayQueue {
  const first = start ?? (queue.shuffle ? shuffled(ids, random)[0] : ids[0]) ?? null;
  const order = queue.shuffle
    ? [
        first,
        ...shuffled(
          ids.filter((id) => id !== first),
          random,
        ),
      ].filter((id): id is string => id !== null)
    : [...ids];
  return {
    ...queue,
    base: ids,
    order,
    index: first === null ? -1 : order.indexOf(first),
    current: first,
    history: remember(queue),
  };
}

function remember(queue: PlayQueue): readonly string[] {
  if (queue.current === null) return queue.history;
  return [...queue.history, queue.current].slice(-MAX_HISTORY);
}

/** What will play after this song, without moving anything. */
export function peekNext(queue: PlayQueue): string | null {
  if (queue.repeat === 'one' && queue.current !== null) return queue.current;
  const picked = queue.upNext[0];
  if (picked !== undefined) return picked;
  const next = queue.order[queue.index + 1];
  if (next !== undefined) return next;
  return queue.repeat === 'all' ? (queue.order[0] ?? null) : null;
}

/**
 * Moves on. A skip goes to the next song even on repeat-one: someone pressing next wants
 * something else, where a song simply ending should start again.
 */
export function advance(
  queue: PlayQueue,
  skipped: boolean,
  random: () => number = Math.random,
): PlayQueue {
  if (queue.repeat === 'one' && !skipped && queue.current !== null) return queue;
  const [picked, ...rest] = queue.upNext;
  if (picked !== undefined) {
    return { ...queue, upNext: rest, current: picked, history: remember(queue) };
  }
  const next = queue.index + 1;
  if (next < queue.order.length) {
    return { ...queue, index: next, current: queue.order[next] ?? null, history: remember(queue) };
  }
  if (queue.repeat === 'off' && !skipped) return { ...queue, current: null, index: -1 };
  if (queue.order.length === 0) return queue;
  // Round again, reshuffled, without repeating the song that just finished.
  const order = queue.shuffle ? reshuffle(queue, random) : queue.order;
  return { ...queue, order, index: 0, current: order[0] ?? null, history: remember(queue) };
}

function reshuffle(queue: PlayQueue, random: () => number): readonly string[] {
  const order = shuffled(queue.order, random);
  if (order.length > 1 && order[0] === queue.current) {
    const swap = 1 + Math.floor(random() * (order.length - 1));
    const first = order[0] as string;
    order[0] = order[swap] as string;
    order[swap] = first;
  }
  return order;
}

/** Back through what actually played, then up the list. */
export function goBack(queue: PlayQueue): PlayQueue {
  const previous = queue.history[queue.history.length - 1];
  if (previous === undefined) {
    if (queue.index <= 0) return queue;
    const index = queue.index - 1;
    return { ...queue, index, current: queue.order[index] ?? null };
  }
  const index = queue.order.indexOf(previous);
  return {
    ...queue,
    current: previous,
    index: index >= 0 ? index : queue.index,
    history: queue.history.slice(0, -1),
  };
}

export function playNext(queue: PlayQueue, id: string): PlayQueue {
  return { ...queue, upNext: [id, ...queue.upNext.filter((other) => other !== id)] };
}

export function addToQueue(queue: PlayQueue, id: string): PlayQueue {
  return { ...queue, upNext: [...queue.upNext.filter((other) => other !== id), id] };
}

export function removeFromQueue(queue: PlayQueue, position: number): PlayQueue {
  return { ...queue, upNext: queue.upNext.filter((_, i) => i !== position) };
}

/** Shuffles what's left around the song playing now, or puts the original order back. */
export function setShuffle(
  queue: PlayQueue,
  on: boolean,
  random: () => number = Math.random,
): PlayQueue {
  if (on === queue.shuffle) return queue;
  const { current } = queue;
  const order = on
    ? [
        current,
        ...shuffled(
          queue.base.filter((id) => id !== current),
          random,
        ),
      ].filter((id): id is string => id !== null)
    : queue.base;
  const index = current === null ? -1 : order.indexOf(current);
  return { ...queue, shuffle: on, order, index };
}

export function cycleRepeat(queue: PlayQueue): PlayQueue {
  const repeat: Repeat = queue.repeat === 'all' ? 'one' : queue.repeat === 'one' ? 'off' : 'all';
  return { ...queue, repeat };
}

/** What's coming, in order, for showing to the listener. */
export function upcoming(queue: PlayQueue, limit: number): string[] {
  const rest = queue.order.slice(queue.index + 1);
  const wrapped = queue.repeat === 'all' ? queue.order.slice(0, queue.index + 1) : [];
  return [...queue.upNext, ...rest, ...wrapped].slice(0, limit);
}
