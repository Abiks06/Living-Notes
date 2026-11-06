import { beforeEach, describe, expect, it, vi } from 'vitest';
import source from './sw.js?raw';

const ORIGIN = 'https://example.test';
const ASSET = '/assets/index-abc123.js';

type Listener = (event: unknown) => void;

function loadWorker(cached: Map<string, string>, network: () => Promise<string>) {
  const listeners = new Map<string, Listener>();
  const added: string[] = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  };
  const caches = {
    open: vi.fn(async () => ({
      addAll: async (files: string[]) => {
        added.push(...files);
      },
    })),
    match: async (request: string | { url: string }) =>
      cached.get(typeof request === 'string' ? request : new URL(request.url).pathname),
    keys: async () => ['resonance-old', 'resonance-v1', 'someone-elses'],
    delete: vi.fn(async (_key: string) => true),
  };
  const script = source
    .replace('__VERSION__', 'v1')
    .replace('__FILES__', JSON.stringify(['/', '/favicon.svg', ASSET]));
  new Function('self', 'caches', 'fetch', script)(self, caches, network);

  const fetchEvent = (path: string, init: { method?: string; mode?: string } = {}) => {
    const respondWith = vi.fn();
    const url = path.startsWith('http') ? path : ORIGIN + path;
    listeners.get('fetch')?.({
      request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' },
      respondWith,
    });
    return respondWith;
  };
  const lifecycle = async (type: string) => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({ waitUntil: (work: Promise<unknown>) => (done = work) });
    await done;
  };
  return { fetchEvent, lifecycle, added, caches };
}

describe('service worker', () => {
  let worker: ReturnType<typeof loadWorker>;

  beforeEach(() => {
    worker = loadWorker(
      new Map([
        ['/', 'cached page'],
        [ASSET, 'cached asset'],
      ]),
      () => Promise.reject(new Error('offline')),
    );
  });

  it('leaves the demo track check to the server, so a missing file stays a 404', () => {
    expect(worker.fetchEvent('/audio/demo-1.mp3', { method: 'HEAD' })).not.toHaveBeenCalled();
    expect(worker.fetchEvent('/audio/demo-1.mp3')).not.toHaveBeenCalled();
  });

  it('never answers for anything outside the file list', () => {
    expect(worker.fetchEvent('/assets/unknown.js')).not.toHaveBeenCalled();
    expect(worker.fetchEvent('/missing', { mode: 'navigate' })).not.toHaveBeenCalled();
    expect(worker.fetchEvent('https://elsewhere.test/assets/x.js')).not.toHaveBeenCalled();
    expect(worker.fetchEvent(ASSET, { method: 'POST' })).not.toHaveBeenCalled();
  });

  it('only stores the build’s own files, and only while installing', async () => {
    await worker.lifecycle('install');
    expect(worker.added).toEqual(['/', '/favicon.svg', ASSET]);
  });

  it('writes nothing when a listed file has to come from the network', async () => {
    const online = loadWorker(new Map(), async () => 'fresh file');
    const respondWith = online.fetchEvent(ASSET);
    await expect(respondWith.mock.calls[0]?.[0]).resolves.toBe('fresh file');
    expect(online.caches.open).not.toHaveBeenCalled();
  });

  it('serves listed files from the cache', async () => {
    const respondWith = worker.fetchEvent(ASSET);
    await expect(respondWith.mock.calls[0]?.[0]).resolves.toBe('cached asset');
  });

  it('opens the page from the cache when offline, shared link or not', async () => {
    const respondWith = worker.fetchEvent('/?look=ember', { mode: 'navigate' });
    await expect(respondWith.mock.calls[0]?.[0]).resolves.toBe('cached page');
  });

  it('prefers the server’s page when it answers', async () => {
    const online = loadWorker(new Map([['/', 'cached page']]), async () => 'fresh page');
    const respondWith = online.fetchEvent('/', { mode: 'navigate' });
    await expect(respondWith.mock.calls[0]?.[0]).resolves.toBe('fresh page');
  });

  it('removes older versions and leaves other caches alone', async () => {
    await worker.lifecycle('activate');
    expect(worker.caches.delete.mock.calls).toEqual([['resonance-old']]);
  });
});
