import { create } from 'zustand';
import { isReturning, markReturning } from '../state/returning';
import { EMPTY_QUEUE, type PlayQueue, syncQueue } from './queue';
import type { ResumePoint } from './resume';
import { readCachedTags, readSetting, writeCachedTags, writeSetting } from './storage';
import { cleanTitle, nameParts, namedBackwards, readTags, type Tags } from './tags';

export const AUDIO_FILE = /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus)$/i;

export interface Track {
  readonly id: string;
  readonly fileName: string;
  /** Tidied for display, from the tags or else the file name. */
  readonly title: string;
  readonly artist: string;
  /** The name came from the file, so which part is the song was an assumption. */
  readonly guessed: boolean;
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

export type LibraryPeek = 'off' | 'in' | 'out';

interface LibraryState {
  tracks: readonly Track[];
  byId: ReadonlyMap<string, Track>;
  folder: string | null;
  /** A folder from last time, waiting for one click to be allowed back in. */
  saved: string | null;
  scan: { done: number; total: number } | null;
  /** Whether the open folder can be looked at again without asking. */
  watching: boolean;
  queue: PlayQueue;
  nowPlaying: Track | null;
  /** Shown near the end of a song. */
  comingUp: Track | null;
  crossfade: number;
  artColours: boolean;
  /** The song to carry on with, until something else starts. */
  resume: ResumePoint | null;
  open: boolean;
  /** Slid in by the mouse at the edge of the window, rather than opened on purpose. */
  peek: LibraryPeek;
  setOpen: (open: boolean) => void;
  setPeek: (peek: LibraryPeek) => void;
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
  watching: false,
  queue: EMPTY_QUEUE,
  nowPlaying: null,
  comingUp: null,
  crossfade: 3,
  artColours: true,
  resume: null,
  // A player opens on your music.
  open: isReturning(),
  peek: 'off',
  // Opening it on purpose takes over from a peek, so it stays until it's closed.
  setOpen: (open) => set({ open, peek: 'off' }),
  setPeek: (peek) => set({ peek }),
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
/** Where songs that came in loose, rather than from a folder, are filed. */
const DROPPED = 'dropped/';
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
    guessed: !tags.title && !tags.artist && !tags.albumArtist && guess.artist !== undefined,
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

/** A file name can only be judged against the rest of the library. */
function straightened(track: Track, all: readonly Track[]): Track {
  if (!namedBackwards(track, all)) return track;
  return { ...track, title: track.artist, artist: track.title, guessed: false };
}

function publish(tracks: Track[]): void {
  const sorted = tracks.map((track) => straightened(track, tracks)).sort(compareTracks);
  const byId = new Map(sorted.map((track) => [track.id, track]));
  // A song picked mid-scan can turn out to have been named backwards once more of the folder is in.
  const { nowPlaying } = library();
  const corrected = nowPlaying ? byId.get(nowPlaying.id) : undefined;
  const renamed = corrected !== undefined && corrected.title !== nowPlaying?.title;
  useLibrary.setState({ tracks: sorted, byId, ...(renamed ? { nowPlaying: corrected } : {}) });
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
  const earlier = new Set(library().tracks.map((track) => track.id));
  // Songs dropped in while this runs aren't part of the folder, but they're still in the library.
  const withDropped = () => [
    ...library().tracks.filter((track) => track.id.startsWith(DROPPED) && !earlier.has(track.id)),
    ...tracks,
  ];
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
        publish(withDropped());
        useLibrary.setState({ scan: { done: tracks.length, total: found.length } });
      }
    }
  };
  await Promise.all(Array.from({ length: SCAN_WIDTH }, worker));
  publish(withDropped());
  useLibrary.setState({ scan: null });
  if (tracks.length > 0) markReturning();
  // The song may have been moved, or this may be a different folder.
  const { resume, byId } = library();
  if (resume && !byId.has(resume.id)) useLibrary.setState({ resume: null });
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

let openFolder: FolderHandle | null = null;
let refreshing = false;

async function scanFolder(folder: FolderHandle): Promise<void> {
  const found: Found[] = [];
  await walk(folder, folder.name, found);
  await addAll(found, folder.name);
  openFolder = folder;
  useLibrary.setState({ watching: true });
}

export interface FolderChanges {
  added: number;
  removed: number;
}

async function describeAll(found: readonly Found[]): Promise<Track[]> {
  const tracks: Track[] = [];
  let next = 0;
  const worker = async () => {
    while (next < found.length) {
      const item = found[next++];
      const track = item ? await describe(item) : null;
      if (track) tracks.push(track);
    }
  };
  await Promise.all(Array.from({ length: SCAN_WIDTH }, worker));
  return tracks;
}

/** Brings the library in line with the folder. What's playing is left alone. */
export async function refreshLibrary(): Promise<FolderChanges> {
  const none = { added: 0, removed: 0 };
  const folder = openFolder;
  if (!folder || refreshing || library().scan) return none;
  refreshing = true;
  try {
    if ((await folder.queryPermission({ mode: 'read' })) !== 'granted') return none;
    const found: Found[] = [];
    // If the folder can't be read, say a drive was unplugged, nothing is treated as deleted.
    await walk(folder, folder.name, found);
    const paths = new Set(found.map((item) => item.path));
    const inFolder = (track: Track) => track.id.startsWith(`${folder.name}/`);
    const before = library().tracks;
    const removed = before.filter((track) => inFolder(track) && !paths.has(track.id));
    const fresh = found.filter((item) => !library().byId.has(item.path));
    if (removed.length === 0 && fresh.length === 0) return none;

    const added = await describeAll(fresh);
    if (openFolder !== folder) return none;
    const gone = new Set(removed.map((track) => track.id));
    const { queue } = library();
    const wholeLibrary =
      queue.base.length > 0 && queue.base.length >= before.filter(inFolder).length;
    publish([...library().tracks.filter((track) => !gone.has(track.id)), ...added]);
    useLibrary.setState({
      queue: syncQueue(
        queue,
        wholeLibrary ? added.map((track) => track.id) : [],
        removed.map((track) => track.id),
      ),
    });
    return { added: added.length, removed: removed.length };
  } catch {
    return none;
  } finally {
    refreshing = false;
  }
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
    // Asks the browser not to clear what's stored here, including this folder, when space is low.
    void navigator.storage?.persist?.();
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
  openFolder = null;
  useLibrary.setState({ watching: false });
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
        path: `${DROPPED}${file.name}/${file.size}`,
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
  const [crossfade, artColours, folder, lastSong] = await Promise.all([
    readSetting<number>('crossfade'),
    readSetting<boolean>('artColours'),
    readSetting<FolderHandle>('folder'),
    readSetting<ResumePoint>('lastSong'),
  ]);
  if (crossfade !== undefined) useLibrary.setState({ crossfade });
  if (artColours !== undefined) useLibrary.setState({ artColours });
  if (!folder?.queryPermission) return;
  // Shown straight away, as a folder can take a moment to read or need a click to reopen.
  if (lastSong) useLibrary.setState({ resume: lastSong });
  if ((await folder.queryPermission({ mode: 'read' })) === 'granted') await scanFolder(folder);
  else useLibrary.setState({ saved: folder.name });
}

export function writeLastSong(point: ResumePoint): void {
  void writeSetting('lastSong', point);
}

/** One click to get back into last time's folder. */
export async function reopenFolder(): Promise<void> {
  const folder = await readSetting<FolderHandle>('folder');
  if (!folder) return;
  if ((await folder.requestPermission({ mode: 'read' })) === 'granted') await scanFolder(folder);
}
