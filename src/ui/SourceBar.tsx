import { useRef } from 'react';
import { DEMO_TRACKS } from '../audio/demoTracks';
import { useAppStore } from '../state/appStore';
import { isTabAudioSupported } from '../audio/sources';
import {
  enableMic,
  enableTabAudio,
  ensureStarted,
  loadFiles,
  startExperience,
} from '../state/actions';
import { FileIcon, MicIcon, TabAudioIcon } from './icons';

// Decided once: getDisplayMedia support doesn't change during a session.
const TAB_AUDIO = isTabAudioSupported();

export function SourceBar() {
  const source = useAppStore((state) => state.source);
  const loading = useAppStore((state) => state.loading);
  const mic = useAppStore((state) => state.mic);
  const fileInput = useRef<HTMLInputElement>(null);

  const micActive = source?.kind === 'mic';
  const fileName = source?.kind === 'file' ? source.name : null;

  return (
    <div className="source-bar">
      <div className="source-bar__presets" role="group" aria-label="Demo tracks">
        {DEMO_TRACKS.map((track) => {
          const active = source?.kind === 'demo' && source.id === track.id;
          const busy = loading === track.title;
          return (
            <button
              key={track.id}
              type="button"
              className="chip"
              aria-pressed={active}
              aria-busy={busy}
              onClick={() => startExperience(track.id)}
            >
              <span className="chip__title">{track.title}</span>
              <span className="chip__meta">{busy ? 'Loading…' : track.mood}</span>
            </button>
          );
        })}
      </div>

      <div className="source-bar__inputs">
        <button
          type="button"
          className="icon-button"
          aria-pressed={micActive}
          aria-busy={mic === 'requesting'}
          onClick={() => {
            if (ensureStarted()) void enableMic();
          }}
        >
          <MicIcon />
          <span>{mic === 'requesting' ? 'Waiting…' : micActive ? 'Listening' : 'Mic'}</span>
        </button>

        <button
          type="button"
          className="icon-button"
          aria-pressed={fileName !== null}
          title={fileName ?? 'Open an audio file'}
          onClick={() => {
            if (ensureStarted()) fileInput.current?.click();
          }}
        >
          <FileIcon />
          <span className="icon-button__label">{fileName ?? 'Open file'}</span>
        </button>
        {TAB_AUDIO && (
          <button
            type="button"
            className="icon-button"
            aria-pressed={source?.kind === 'tab'}
            aria-busy={loading === 'Tab audio'}
            title="Visualize another tab — Spotify, YouTube, SoundCloud…"
            onClick={() => {
              if (ensureStarted()) void enableTabAudio();
            }}
          >
            <TabAudioIcon />
            <span>{source?.kind === 'tab' ? 'Sharing' : 'Tab audio'}</span>
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length > 0) void loadFiles(files);
          }}
        />
      </div>
    </div>
  );
}
