import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { audioEngine } from '../audio/AudioEngine';
import { formatTime } from '../lib/formatTime';
import { artFor } from '../library/art';
import { useLibrary } from '../library/library';
import { playTracks, skipNext, skipPrevious, toggleRepeat, toggleShuffle } from '../library/player';
import { ensureStarted, setVolume, toggleMute, togglePlayback } from '../state/actions';
import { useSettings } from '../settings/settingsStore';
import { type ActiveSource, useAppStore } from '../state/appStore';
import {
  LibraryIcon,
  MutedIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  SkipIcon,
  SlidersIcon,
  VolumeIcon,
} from './icons';
import { SeekBar } from './SongMap';
import { STUDIO_TOGGLE_ID } from './studio/studioIds';
import { VisualsMenu } from './VisualsMenu';

/** The clock repaints at ~4 Hz; it only shows seconds. */
const CLOCK_INTERVAL_S = 1 / 4;
/** Matches the player's small layout in global.css. */
const NARROW = '(max-width: 720px)';

function describe(source: ActiveSource | null): { title: string; detail: string } {
  switch (source?.kind) {
    case 'mic':
      return { title: 'Microphone', detail: 'Listening live' };
    case 'tab':
      return { title: 'Tab audio', detail: 'Listening live' };
    case 'file':
      return { title: source.title ?? source.name, detail: source.artist ?? '' };
    case 'demo':
      return { title: source.title, detail: 'Demo' };
    default:
      return { title: 'Nothing playing', detail: 'Choose some music' };
  }
}

function Clock() {
  const clock = useRef<HTMLSpanElement>(null);
  const total = useRef<HTMLSpanElement>(null);
  const [remaining, setRemaining] = useState(false);

  useEffect(() => {
    let elapsed = CLOCK_INTERVAL_S;
    let shownSecond = NaN;
    let shownTotal = -1;
    return audioEngine.onFrame((dt) => {
      elapsed += dt;
      if (elapsed < CLOCK_INTERVAL_S) return;
      elapsed = 0;
      const transport = audioEngine.transport;
      if (!transport) return;
      // The element can also pause itself (OS media keys, audio focus loss).
      if (transport.paused !== useAppStore.getState().paused) {
        useAppStore.getState().setPaused(transport.paused);
      }
      const length = Number.isFinite(transport.duration) ? Math.floor(transport.duration) : 0;
      const second = Math.floor(transport.currentTime());
      const shown = remaining ? second - length : second;
      if (shown !== shownSecond && clock.current) {
        shownSecond = shown;
        clock.current.textContent = `${remaining ? '−' : ''}${formatTime(Math.abs(shown))}`;
      }
      if (length !== shownTotal && total.current) {
        shownTotal = length;
        total.current.textContent = formatTime(length);
      }
    });
  }, [remaining]);

  return (
    <button
      type="button"
      className="player__time"
      title={remaining ? 'Show time played' : 'Show time left'}
      onClick={() => setRemaining(!remaining)}
    >
      <span ref={clock}>0:00</span>
      <span aria-hidden="true"> / </span>
      <span ref={total}>0:00</span>
    </button>
  );
}

/** The whole player: what's on, the controls, and the way into the library and visuals. */
export function PlayerBar() {
  const phase = useAppStore((state) => state.phase);
  const source = useAppStore((state) => state.source);
  const paused = useAppStore((state) => state.paused);
  const volume = useAppStore((state) => state.volume);
  const muted = useAppStore((state) => state.muted);
  const loading = useAppStore((state) => state.loading);
  const playing = useLibrary((state) => state.nowPlaying);
  const shuffle = useLibrary((state) => state.queue.shuffle);
  const repeat = useLibrary((state) => state.queue.repeat);
  const auto = useSettings((state) => state.autoDirector);
  const libraryOpen = useLibrary((state) => state.open);
  const setLibraryOpen = useLibrary((state) => state.setOpen);
  const [art, setArt] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    let live = true;
    setArt(null);
    if (playing) {
      void artFor(playing).then((url) => {
        if (live) setArt(url);
      });
    }
    return () => {
      live = false;
    };
  }, [playing]);

  if (phase === 'intro') return null;

  const hasTimeline = source !== null && source.kind !== 'mic' && source.kind !== 'tab';
  const { title, detail } = describe(source);

  const onPlay = () => {
    if (audioEngine.transport) {
      togglePlayback();
      return;
    }
    const tracks = useLibrary.getState().tracks;
    if (tracks.length > 0 && ensureStarted()) {
      playTracks(
        tracks.map((track) => track.id),
        null,
      );
    } else {
      setLibraryOpen(true);
    }
  };

  return (
    <section className="player chrome" aria-label="Player">
      {hasTimeline && <SeekBar />}

      <button
        type="button"
        className="player__song"
        title="Your music (Q)"
        onClick={() => setLibraryOpen(!libraryOpen)}
      >
        {art ? (
          <img className="player__art" src={art} alt="" />
        ) : (
          <span className="player__art player__art--empty" aria-hidden="true">
            <LibraryIcon />
          </span>
        )}
        <span className="player__words" aria-live="polite">
          <span className="player__title">{loading ?? title}</span>
          <span className="player__detail">{loading ? 'Loading' : detail}</span>
        </span>
      </button>

      <div className="player__controls">
        <button
          type="button"
          className="control control--extra control--mode"
          aria-label="Shuffle"
          aria-pressed={shuffle}
          title="Shuffle (S)"
          onClick={toggleShuffle}
        >
          <ShuffleIcon />
        </button>
        <button
          type="button"
          className="control"
          aria-label="Previous"
          title="Previous (P)"
          disabled={!playing}
          onClick={skipPrevious}
        >
          <SkipIcon style={{ transform: 'scaleX(-1)' }} />
        </button>
        <button
          type="button"
          className="control control--play"
          aria-label={paused || !hasTimeline ? 'Play' : 'Pause'}
          title="Play or pause (Space)"
          onClick={onPlay}
        >
          {paused || !hasTimeline ? <PlayIcon /> : <PauseIcon />}
        </button>
        <button
          type="button"
          className="control"
          aria-label="Next"
          title="Next (N)"
          disabled={!playing}
          onClick={skipNext}
        >
          <SkipIcon />
        </button>
        <button
          type="button"
          className="control control--extra control--mode"
          aria-label={`Repeat ${repeat === 'all' ? 'all' : repeat === 'one' ? 'one song' : 'off'}`}
          aria-pressed={repeat !== 'off'}
          title="Repeat (R)"
          onClick={toggleRepeat}
        >
          {repeat === 'one' ? <RepeatOneIcon /> : <RepeatIcon />}
        </button>
      </div>

      <div className="player__side">
        {hasTimeline && <Clock />}
        <div className="player__volume">
          <button
            type="button"
            className="control"
            aria-label={muted ? 'Unmute' : 'Mute'}
            aria-pressed={muted}
            title="Mute (M)"
            onClick={toggleMute}
          >
            {muted ? <MutedIcon /> : <VolumeIcon />}
          </button>
          <input
            className="volume"
            style={{ '--level': `${(muted ? 0 : volume) * 100}%` } as CSSProperties}
            onWheel={(event) =>
              setVolume(Math.min(1, Math.max(0, volume - Math.sign(event.deltaY) * 0.05)))
            }
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            aria-label="Volume"
            onChange={(event) => setVolume(event.currentTarget.valueAsNumber)}
          />
        </div>
        <button
          type="button"
          className="control control--extra"
          aria-label="Your music"
          aria-expanded={libraryOpen}
          aria-controls="library"
          title="Your music (Q)"
          onClick={() => setLibraryOpen(!libraryOpen)}
        >
          <LibraryIcon />
        </button>
        <button
          id={STUDIO_TOGGLE_ID}
          type="button"
          className="control control--mode"
          data-on={auto}
          aria-label={auto ? 'Visuals, Auto on' : 'Visuals'}
          aria-expanded={menu}
          title={auto ? 'Visuals · Auto is on' : 'Visuals'}
          onClick={() => {
            // A phone only has room for one of them.
            if (window.matchMedia(NARROW).matches) setLibraryOpen(false);
            setMenu(!menu);
          }}
        >
          <SlidersIcon />
        </button>
      </div>

      {menu && <VisualsMenu onClose={() => setMenu(false)} />}
    </section>
  );
}
