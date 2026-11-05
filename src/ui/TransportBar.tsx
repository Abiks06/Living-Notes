import { type ReactNode, useEffect, useRef, useState } from 'react';
import { audioEngine } from '../audio/AudioEngine';
import { formatTime } from '../lib/formatTime';
import { isShortcutKey, ownsSpace } from '../lib/keyboard';
import { useAppStore } from '../state/appStore';
import {
  jumpSection,
  seekTo,
  setVolume,
  skipTrack,
  toggleMute,
  togglePlayback,
} from '../state/actions';
import { MutedIcon, PauseIcon, PlayIcon, SkipIcon, VolumeIcon } from './icons';

/** The scrubber and clock repaint at ~12 Hz; plenty for a time readout. */
const UI_INTERVAL_S = 1 / 12;

/**
 * The dock's top row: the spectrum, with play/pause, seek and volume folded around it.
 * The controls disappear for live inputs, which have no timeline or output.
 */
export function TransportBar({ children }: { children: ReactNode }) {
  const source = useAppStore((state) => state.source);
  const paused = useAppStore((state) => state.paused);
  const volume = useAppStore((state) => state.volume);
  const muted = useAppStore((state) => state.muted);
  const queue = useAppStore((state) => state.queue);
  const mapped = useAppStore((state) => state.song !== null);
  const scrubber = useRef<HTMLInputElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);
  const [duration, setDuration] = useState(0);

  const hasTimeline = source !== null && source.kind !== 'mic' && source.kind !== 'tab';

  // Follow playback without React re-renders: write straight to the DOM on the frame tick.
  useEffect(() => {
    if (!hasTimeline) return;
    let elapsed = UI_INTERVAL_S;
    let shownSecond = -1;
    let shownDuration = 0;
    return audioEngine.onFrame((dt) => {
      elapsed += dt;
      if (elapsed < UI_INTERVAL_S) return;
      elapsed = 0;
      const transport = audioEngine.transport;
      if (!transport) return;

      const total = Number.isFinite(transport.duration) ? transport.duration : 0;
      if (total !== shownDuration) {
        shownDuration = total;
        setDuration(total);
      }
      // The element can also pause itself (OS media keys, audio focus loss).
      if (transport.paused !== useAppStore.getState().paused) {
        useAppStore.getState().setPaused(transport.paused);
      }
      if (dragging.current) return;
      const now = transport.currentTime();
      if (scrubber.current) scrubber.current.valueAsNumber = now;
      const second = Math.floor(now);
      if (second !== shownSecond && clock.current) {
        shownSecond = second;
        clock.current.textContent = formatTime(now);
      }
    });
  }, [hasTimeline, source]);

  // Space = play/pause, M = mute.
  useEffect(() => {
    let spaceHandled = false;
    const onKey = (event: KeyboardEvent) => {
      if (!isShortcutKey(event)) return;
      if (event.code === 'Space') {
        if (ownsSpace(event.target) || !audioEngine.transport) return;
        event.preventDefault();
        spaceHandled = true;
        if (!event.repeat) togglePlayback();
      } else if (event.key === 'm' || event.key === 'M') {
        toggleMute();
      } else if (event.key === 'n' || event.key === 'N') {
        skipTrack(1);
      } else if (event.key === 'p' || event.key === 'P') {
        skipTrack(-1);
      } else if (event.key === ']') {
        jumpSection(1);
      } else if (event.key === '[') {
        jumpSection(-1);
      }
    };
    // Firefox activates a focused button on keyup, so that has to be cancelled too.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !spaceHandled) return;
      spaceHandled = false;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const commitSeek = () => {
    if (!dragging.current || !scrubber.current) return;
    dragging.current = false;
    seekTo(scrubber.current.valueAsNumber);
  };

  return (
    <div className="dock__meter">
      {hasTimeline && (
        <div className="transport__buttons">
          {queue && (
            <button
              type="button"
              className="transport__skip"
              aria-label="Previous track"
              onClick={() => skipTrack(-1)}
            >
              <SkipIcon style={{ transform: 'scaleX(-1)' }} />
            </button>
          )}
          <button
            type="button"
            className="transport__play"
            aria-label={paused ? 'Play' : 'Pause'}
            onClick={togglePlayback}
          >
            {paused ? <PlayIcon /> : <PauseIcon />}
          </button>
          {queue && (
            <button
              type="button"
              className="transport__skip"
              aria-label="Next track"
              onClick={() => skipTrack(1)}
            >
              <SkipIcon />
            </button>
          )}
        </div>
      )}

      <div className="dock__spectrum">
        {children}
        {hasTimeline && !mapped && (
          <input
            ref={scrubber}
            className="transport__scrubber"
            type="range"
            min={0}
            max={duration || 1}
            step={0.01}
            defaultValue={0}
            aria-label="Seek"
            disabled={duration === 0}
            onPointerDown={() => {
              dragging.current = true;
            }}
            onPointerUp={commitSeek}
            onPointerCancel={commitSeek}
            onChange={(event) => {
              const value = event.currentTarget.valueAsNumber;
              if (clock.current) clock.current.textContent = formatTime(value);
              // Keyboard arrows seek immediately; pointer drags seek on release.
              if (!dragging.current) seekTo(value);
            }}
          />
        )}
      </div>

      {hasTimeline && (
        <>
          <span className="transport__time">
            <span ref={clock}>0:00</span> / {formatTime(duration)}
            {queue && (
              <span className="transport__track">
                {queue.index + 1} of {queue.length}
              </span>
            )}
          </span>
          <button
            type="button"
            className="transport__mute"
            aria-label={muted ? 'Unmute' : 'Mute'}
            aria-pressed={muted}
            onClick={toggleMute}
          >
            {muted ? <MutedIcon /> : <VolumeIcon />}
          </button>
          <input
            className="transport__volume"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            aria-label="Volume"
            onChange={(event) => setVolume(event.currentTarget.valueAsNumber)}
          />
        </>
      )}
    </div>
  );
}
