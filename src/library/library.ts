import { create } from 'zustand';
import { EMPTY_QUEUE, type PlayQueue } from './queue';
import { readCachedTags, readSetting, writeCachedTags, writeSetting } from './storage';
import { cleanTitle, nameParts, readTags, type Tags } from './tags';

export const AUDIO_FILE = /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus)$/i;

export interface Track {
  readonly id: string;
  readonly fileName: string;
  /** Tidied for display, from the tags or else the file name. */
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly year: string;
  readonly genre: string;
  readonly number: number;
  readonly disc: number;
  readonly duration: number;
  readonly cover: Tags['cover'];
  /** Files are only opened when they're about to be used. */
  open(): Promise<File>;
}

interface Found {
  path: string;
  open(): Promise<File>;
}

interface LibraryState {
  tracks: readonly Track[];
  byId: ReadonlyMap<string, Track>;
  folder: string | null;
  /** A folder from last time, waiting for one click to be allowed back in. */
  saved: string | null;
  scan: { done: number; total: number } | null;
  queue: PlayQueue;
  nowPlaying: Track | null;
  /** Shown near the end of a song. */
  comingUp: Track | null;
  crossfade: number;
  artColours: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  setQueue: (queue: PlayQueue) => void;
  setNowPlaying: (track: Track | null) => void;
  setComingUp: (track: Track | null) => void;
  setCrossfade: (seconds: number) => void;
  setArtColours: (on: boolean) => void;
}

export const useLibrary = create<LibraryState>()((set) => ({
  tracks: [],
  byId: new Map(),
  folder: null,
  saved: null,
  scan: null,
  queue: EMPTY_QUEUE,
  nowPlaying: null,
  comingUp: null,
  crossfade: 3,
  artColours: true,
  open: false,
  setOpen: (open) => set({ open }),
  setQueue: (queue) => set({ queue }),
  setNowPlaying: (nowPlaying) => set({ nowPlaying }),
  setComingUp: (comingUp) => set({ comingUp }),
  setCrossfade: (crossfade) => {
    set({ crossfade });
    void writeSetting('crossfade', crossfade);
  },
  setArtColours: (artColours) => {
    set({ artColours });
    void writeSetting('artColours', artColours);
  },
}));

const library = () => useLibrary.getState();

/** Enough files read at once to hide the disk's latency, not so many that it thrashes. */
const SCAN_WIDTH = 8;
/** How often the list refreshes during a scan: every track would mean a render for each. */
const SCAN_REFRESH_MS = 250;
/** Raise when tags learn something new, so songs scanned before are read again. */
const TAGS_VERSION = 2;

function toTrack(found: Found, file: File, tags: Tags): Track {
  const guess = nameParts(file.name);
  return {
    id: found.path,
    fileName: file.name,
    title: cleanTitle(tags.title ?? guess.title),
    artist: tags.artist ?? tags.albumArtist ?? guess.artist ?? 'Unknown artist',
    album: tags.album ?? '',
    year: tags.year ?? '',
    genre: tags.genre ?? '',
    number: tags.track ?? 0,
    disc: tags.disc ?? 0,
    duration: tags.duration ?? 0,
    cover: tags.cover,
    open: found.open,
  };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareTracks(a: Track, b: Track): number {
  return (
    collator.compare(a.artist, b.artist) ||
    collator.compare(a.album, b.album) ||
    a.disc - b.disc ||
    a.number - b.number ||
    collator.compare(a.title, b.title)
  );
}

function publish(tracks: Track[]): void {
  const sorted = [...tracks].sort(compareTracks);
  useLibrary.setState({ tracks: sorted, byId: new Map(sorted.map((track) => [track.id, track])) });
}

async function describe(found: Found): Promise<Track | null> {
  try {
    const file = await found.open();
    const key = `${TAGS_VERSION}|${found.path}|${file.size}|${file.lastModified}`;
    let tags = await readCachedTags(key);
    if (!tags) {
      tags = await readTags(file);
      void writeCachedTags(key, tags);
    }
    return toTrack(found, file, tags);
  } catch {
    return null; // Moved or unreadable since the folder was listed.
  }
}

/** Reads every file's tags, a few at a time, showing songs as they're found. */
async function addAll(found: readonly Found[], folder: string): Promise<Track[]> {
  const tracks: Track[] = [];
  useLibrary.setState({ folder, saved: null, scan: { done: 0, total: found.length } });
  let next = 0;
  let last = performance.now();
  const worker = async () => {
    while (next < found.length) {
      const item = found[next++];
      if (!item) continue;
      const track = await describe(item);
      if (track) tracks.push(track);
      const now = performance.now();
      if (now - last >= SCAN_REFRESH_MS) {
        last = now;
        publish(tracks);
        useLibrary.setState({ scan: { done: tracks.length, total: found.length } });
      }
    }
  };
  await Promise.all(Array.from({ length: SCAN_WIDTH }, worker));
  publish(tracks);
  useLibrary.setState({ scan: null });
  return library().tracks as Track[];
}

/** The bits of the File System Access API this uses, which TypeScript's DOM types lack. */
interface FolderEntry {
  kind: 'file' | 'directory';
  name: string;
  getFile?(): Promise<File>;
}
interface FolderHandle extends FolderEntry {
  values(): AsyncIterable<FolderEntry>;
  queryPermission(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'read' }): Promise<PermissionState>;
}
type FolderPicker = (options: {
  id: string;
  mode: 'read';
  startIn: string;
}) => Promise<FolderHandle>;

async function walk(folder: FolderHandle, path: string, out: Found[]): Promise<void> {
  for await (const entry of folder.values()) {
    const here = `${path}/${entry.name}`;
    if (entry.kind === 'directory') await walk(entry as FolderHandle, here, out);
    else if (AUDIO_FILE.test(entry.name) && entry.getFile) {
      out.push({ path: here, open: entry.getFile.bind(entry) });
    }
  }
}

async function scanFolder(folder: FolderHandle): Promise<void> {
  const found: Found[] = [];
  await walk(folder, folder.name, found);
  await addAll(found, folder.name);
}

/** True where a folder can be opened once and remembered. Firefox and Safari can't do this. */
export function canRememberFolder(): boolean {
  return 'showDirectoryPicker' in window;
}

/** Asks for a music folder, and remembers it for next time. False if the visitor cancels. */
export async function pickFolder(): Promise<boolean> {
  const picker = (window as unknown as { showDirectoryPicker: FolderPicker }).showDirectoryPicker;
  try {
    const folder = await picker({ id: 'music', mode: 'read', startIn: 'music' });
    void writeSetting('folder', folder);
    await scanFolder(folder);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return false;
    throw error;
  }
}

/** For browsers without folder access: the files from a folder input. */
export async function addFolderFiles(files: readonly File[]): Promise<void> {
  const audio = files.filter((file) => AUDIO_FILE.test(file.name));
  const folder = audio[0]?.webkitRelativePath.split('/')[0] ?? 'Music';
  await addAll(
    audio.map((file) => ({
      path: file.webkitRelativePath || file.name,
      open: () => Promise.resolve(file),
    })),
    folder,
  );
}

/** Dropped or picked files join the library, and come back as tracks to play. */
export async function addLooseFiles(files: readonly File[]): Promise<Track[]> {
  const tracks = await Promise.all(
    files.map((file) =>
      describe({
        path: `dropped/${file.name}/${file.size}`,
        open: () => Promise.resolve(file),
      }),
    ),
  );
  const added = tracks.filter((track): track is Track => track !== null);
  const known = library().tracks.filter((track) => !added.some((a) => a.id === track.id));
  publish([...known, ...added]);
  return added;
}

/** On load: brings back last time's folder and settings. Nothing is asked without a click. */
export async function restoreLibrary(): Promise<void> {
  const [crossfade, artColours, folder] = await Promise.all([
    readSetting<number>('crossfade'),
    readSetting<boolean>('artColours'),
    readSetting<FolderHandle>('folder'),
  ]);
  if (crossfade !== undefined) useLibrary.setState({ crossfade });
  if (artColours !== undefined) useLibrary.setState({ artColours });
  if (!folder?.queryPermission) return;
  if ((await folder.queryPermission({ mode: 'read' })) === 'granted') await scanFolder(folder);
  else useLibrary.setState({ saved: folder.name });
}

/** One click to get back into last time's folder. */
export async function reopenFolder(): Promise<void> {
  const folder = await readSetting<FolderHandle>('folder');
  if (!folder) return;
  if ((await folder.requestPermission({ mode: 'read' })) === 'granted') await scanFolder(folder);
}
