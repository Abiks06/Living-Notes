import { memo, type UIEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { artFor } from '../../library/art';
import {
  addFolderFiles,
  canRememberFolder,
  pickFolder,
  reopenFolder,
  type Track,
  useLibrary,
} from '../../library/library';
import {
  playFiles,
  playTracks,
  queueAdd,
  queuePlayNext,
  toggleRepeat,
  toggleShuffle,
} from '../../library/player';
import { upcoming } from '../../library/queue';
import { formatTime } from '../../lib/formatTime';
import { DEMO_TRACKS } from '../../audio/demoTracks';
import { isTabAudioSupported } from '../../audio/sources';
import { enableMic, enableTabAudio, ensureStarted, startExperience } from '../../state/actions';
import { useAppStore } from '../../state/appStore';
import { ScrollText } from '../ScrollText';
import { checkForNewSongs } from '../useLibraryWatch';
import {
  CloseIcon,
  FileIcon,
  FolderIcon,
  LibraryIcon,
  MicIcon,
  PlayIcon,
  PlayNextIcon,
  PlusIcon,
  RefreshIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  TabAudioIcon,
} from '../icons';

const ROW_HEIGHT = 56;
/** Rows drawn beyond the visible ones, so a fast scroll doesn't show blanks. */
const OVERSCAN = 6;
const QUEUE_SHOWN = 50;
// Decided once: getDisplayMedia support doesn't change during a session.
const TAB_AUDIO = isTabAudioSupported();

function Cover({ track }: { track: Track }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    void artFor(track).then((art) => {
      if (live) setUrl(art);
    });
    return () => {
      live = false;
    };
  }, [track]);
  return url ? (
    <img className="song__art" src={url} alt="" />
  ) : (
    <span className="song__art song__art--empty" aria-hidden="true">
      <LibraryIcon width={16} height={16} />
    </span>
  );
}

const SongRow = memo(function SongRow({
  track,
  playing,
  onPlay,
  top,
}: {
  track: Track;
  playing: boolean;
  onPlay: (id: string) => void;
  top: number;
}) {
  return (
    <li className="song" style={{ transform: `translateY(${top}px)` }} data-playing={playing}>
      <button
        type="button"
        className="song__play"
        aria-current={playing ? 'true' : undefined}
        onClick={() => onPlay(track.id)}
      >
        <Cover track={track} />
        <span className="song__words">
          <span className="song__title" title={track.title}>
            {track.title}
          </span>
          <ScrollText
            className="song__artist"
            text={track.album ? `${track.artist} · ${track.album}` : track.artist}
          />
        </span>
        {track.duration > 0 && <span className="song__time">{formatTime(track.duration)}</span>}
      </button>
      <button
        type="button"
        className="song__action"
        aria-label={`Play ${track.title} next`}
        title="Play next"
        onClick={() => queuePlayNext(track.id)}
      >
        <PlayNextIcon />
      </button>
      <button
        type="button"
        className="song__action"
        aria-label={`Add ${track.title} to queue`}
        title="Add to queue"
        onClick={() => queueAdd(track.id)}
      >
        <PlusIcon />
      </button>
    </li>
  );
});

/** Only the rows on screen exist, so a library of ten thousand scrolls like one of ten. */
function SongList({ tracks, onPlay }: { tracks: readonly Track[]; onPlay: (id: string) => void }) {
  const playing = useLibrary((state) => state.nowPlaying?.id);
  const box = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(600);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const onScroll = (event: UIEvent<HTMLDivElement>) => setScroll(event.currentTarget.scrollTop);
  const first = Math.max(0, Math.floor(scroll / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(tracks.length, Math.ceil((scroll + height) / ROW_HEIGHT) + OVERSCAN);

  return (
    <div ref={box} className="songs" onScroll={onScroll}>
      <ul className="songs__list" style={{ height: tracks.length * ROW_HEIGHT }}>
        {tracks.slice(first, last).map((track, i) => (
          <SongRow
            key={track.id}
            track={track}
            playing={track.id === playing}
            onPlay={onPlay}
            top={(first + i) * ROW_HEIGHT}
          />
        ))}
      </ul>
    </div>
  );
}

function OpenFolder() {
  const saved = useLibrary((state) => state.saved);
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState('');

  const open = () => {
    setProblem('');
    if (!canRememberFolder()) {
      input.current?.click();
      return;
    }
    pickFolder().catch(() => setProblem('That folder couldn’t be opened. Try another one.'));
  };

  return (
    <div className="library__empty">
      <FolderIcon width={28} height={28} />
      <p>Open a folder and every song in it becomes a show. Your music stays on this device.</p>
      {saved && (
        <button
          type="button"
          className="library__open"
          onClick={() => {
            reopenFolder().catch(() => setProblem('That folder is no longer available.'));
          }}
        >
          Reopen {saved}
        </button>
      )}
      <button type="button" className={saved ? 'library__other' : 'library__open'} onClick={open}>
        {saved ? 'Choose another folder' : 'Open music folder'}
      </button>
      {problem && <p role="alert">{problem}</p>}
      <input
        ref={input}
        type="file"
        hidden
        multiple
        // A non-standard attribute, but every browser supports it.
        {...{ webkitdirectory: '' }}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length > 0) void addFolderFiles(files);
        }}
      />
    </div>
  );
}

function Upcoming({ onPlay }: { onPlay: (id: string) => void }) {
  const queue = useLibrary((state) => state.queue);
  const byId = useLibrary((state) => state.byId);
  const tracks = upcoming(queue, QUEUE_SHOWN)
    .map((id) => byId.get(id))
    .filter((track): track is Track => track !== undefined);
  const repeatLabel = { off: 'Repeat', all: 'Repeat all', one: 'Repeat one' }[queue.repeat];
  return (
    <>
      <div className="queue-modes">
        <button type="button" aria-pressed={queue.shuffle} onClick={toggleShuffle}>
          <ShuffleIcon /> Shuffle
        </button>
        <button type="button" aria-pressed={queue.repeat !== 'off'} onClick={toggleRepeat}>
          {queue.repeat === 'one' ? <RepeatOneIcon /> : <RepeatIcon />} {repeatLabel}
        </button>
      </div>
      {tracks.length === 0 ? (
        <p className="library__note">Nothing’s lined up yet.</p>
      ) : (
        <SongList tracks={tracks} onPlay={onPlay} />
      )}
    </>
  );
}

function OtherSources() {
  const fileInput = useRef<HTMLInputElement>(null);
  const loading = useAppStore((state) => state.loading);
  const source = useAppStore((state) => state.source);
  return (
    <div className="sources">
      <p className="sources__label">Demos</p>
      <ul className="sources__demos">
        {DEMO_TRACKS.map((track) => (
          <li key={track.id}>
            <button
              type="button"
              aria-pressed={source?.kind === 'demo' && source.id === track.id}
              aria-busy={loading === track.title}
              onClick={() => startExperience(track.id)}
            >
              <span>{track.title}</span>
              <small>{track.mood}</small>
            </button>
          </li>
        ))}
      </ul>
      <p className="sources__label">Other sources</p>
      <div className="sources__inputs">
        <button
          type="button"
          onClick={() => {
            if (ensureStarted()) fileInput.current?.click();
          }}
        >
          <FileIcon /> Open files
        </button>
        <button
          type="button"
          aria-pressed={source?.kind === 'mic'}
          onClick={() => {
            if (ensureStarted()) void enableMic();
          }}
        >
          <MicIcon /> Microphone
        </button>
        {TAB_AUDIO && (
          <button
            type="button"
            aria-pressed={source?.kind === 'tab'}
            title="Visualize another tab: Spotify, YouTube, SoundCloud…"
            onClick={() => {
              if (ensureStarted()) void enableTabAudio();
            }}
          >
            <TabAudioIcon /> Tab audio
          </button>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length > 0) void playFiles(files);
        }}
      />
    </div>
  );
}

/** Where the folder can be looked at again this checks it; elsewhere it asks for it once more. */
function RefreshButton() {
  const watching = useLibrary((state) => state.watching);
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="control library__refresh"
        aria-label="Check for new songs"
        title="Check for new songs"
        onClick={() => {
          if (watching) void checkForNewSongs(true);
          else input.current?.click();
        }}
      >
        <RefreshIcon />
      </button>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        // A non-standard attribute, but every browser supports it.
        {...{ webkitdirectory: '' }}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length > 0) void addFolderFiles(files);
        }}
      />
    </>
  );
}

export function LibraryPanel() {
  const tracks = useLibrary((state) => state.tracks);
  const folder = useLibrary((state) => state.folder);
  const scan = useLibrary((state) => state.scan);
  const setOpen = useLibrary((state) => state.setOpen);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'songs' | 'queue' | 'more'>('songs');
  const term = useDeferredValue(search.trim().toLowerCase());

  const shown = useMemo(() => {
    if (!term) return tracks;
    return tracks.filter((track) =>
      `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(term),
    );
  }, [tracks, term]);

  const play = (id: string) => {
    if (ensureStarted()) {
      playTracks(
        shown.map((track) => track.id),
        id,
      );
    }
  };

  return (
    <aside id="library" className="library chrome" aria-label="Music library">
      <header className="library__header">
        <h2>{folder ?? 'Your music'}</h2>
        {folder && <RefreshButton />}
        <button
          type="button"
          className="control"
          aria-label="Close library"
          onClick={() => setOpen(false)}
        >
          <CloseIcon />
        </button>
      </header>

      {tracks.length === 0 && !scan ? (
        <>
          <OpenFolder />
          <OtherSources />
        </>
      ) : (
        <>
          <input
            className="library__search"
            type="search"
            placeholder="Search songs, artists, albums"
            aria-label="Search your music"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
          <div className="library__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'songs'}
              onClick={() => setTab('songs')}
            >
              Songs <span>{scan ? `${scan.done} of ${scan.total}` : shown.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'queue'}
              onClick={() => setTab('queue')}
            >
              Up next
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'more'}
              onClick={() => setTab('more')}
            >
              More
            </button>
            <span className="library__actions">
              <button
                type="button"
                className="library__action"
                aria-label="Play all"
                title="Play all"
                onClick={() => {
                  if (ensureStarted()) {
                    playTracks(
                      shown.map((track) => track.id),
                      null,
                    );
                  }
                }}
              >
                <PlayIcon />
              </button>
              <button
                type="button"
                className="library__action"
                aria-label="Shuffle all"
                title="Shuffle all"
                onClick={() => {
                  if (!ensureStarted()) return;
                  if (!useLibrary.getState().queue.shuffle) toggleShuffle();
                  playTracks(
                    shown.map((track) => track.id),
                    null,
                  );
                }}
              >
                <ShuffleIcon />
              </button>
            </span>
          </div>
          {tab === 'songs' && <SongList tracks={shown} onPlay={play} />}
          {tab === 'queue' && <Upcoming onPlay={play} />}
          {tab === 'more' && <OtherSources />}
        </>
      )}
    </aside>
  );
}
