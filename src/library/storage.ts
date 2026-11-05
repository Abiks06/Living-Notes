import type { Score } from '../audio/score/score';
import type { Tags } from './tags';

const NAME = 'resonance';
/** Bump when analysis changes, so old scores aren't trusted. */
const SCORE_VERSION = 1;
/** Each score is a megabyte or two, so this keeps the cache to a few hundred. */
const MAX_SCORES = 150;
const KV = 'kv';
const TAGS = 'tags';
const SCORES = 'scores';

let opening: Promise<IDBDatabase | null> | null = null;

/** Storage can be missing or refused, as in a private window: everything here then does nothing. */
function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(KV);
      db.createObjectStore(TAGS);
      db.createObjectStore(SCORES).createIndex('used', 'used');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return opening;
}

function done<T>(request: IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
}

async function get<T>(store: string, key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return done(db.transaction(store).objectStore(store).get(key) as IDBRequest<T>);
}

async function put(store: string, key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    await done(db.transaction(store, 'readwrite').objectStore(store).put(value, key));
  } catch {
    // Out of quota, or a value this browser can't store: the app just works without it.
  }
}

export const readSetting = <T>(key: string) => get<T>(KV, key);
export const writeSetting = (key: string, value: unknown) => put(KV, key, value);
export const readCachedTags = (key: string) => get<Tags>(TAGS, key);
export const writeCachedTags = (key: string, tags: Tags) => put(TAGS, key, tags);

const scoreKey = (file: { name: string; size: number; lastModified: number }) =>
  `${SCORE_VERSION}|${file.name}|${file.size}|${file.lastModified}`;

interface StoredScore {
  score: Score;
  used: number;
}

/** A song learned on an earlier day, ready at once. */
export async function readCachedScore(file: File): Promise<Score | undefined> {
  const key = scoreKey(file);
  const stored = await get<StoredScore>(SCORES, key);
  if (!stored) return undefined;
  void put(SCORES, key, { ...stored, used: Date.now() });
  return stored.score;
}

export async function writeCachedScore(file: File, score: Score): Promise<void> {
  await put(SCORES, scoreKey(file), { score, used: Date.now() });
  const db = await open();
  if (!db) return;
  const store = db.transaction(SCORES, 'readwrite').objectStore(SCORES);
  const count = (await done(store.count())) ?? 0;
  if (count <= MAX_SCORES) return;
  // The transaction above has closed by now, so the oldest are removed in a fresh one.
  const fresh = db.transaction(SCORES, 'readwrite').objectStore(SCORES);
  let extra = count - MAX_SCORES;
  fresh.index('used').openKeyCursor().onsuccess = (event) => {
    const cursor = (event.target as IDBRequest<IDBCursor | null>).result;
    if (!cursor || extra <= 0) return;
    fresh.delete(cursor.primaryKey);
    extra--;
    cursor.continue();
  };
}
