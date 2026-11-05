import { type ActiveSource, useAppStore } from '../state/appStore';
import { CastList } from './CastList';
import { MusicDna } from './MusicDna';
import { SongLearning, SongMap } from './SongMap';
import { SourceBar } from './SourceBar';
import { SpectrumStrip } from './SpectrumStrip';
import { TransportBar } from './TransportBar';

function describeSource(source: ActiveSource | null, paused: boolean): string {
  const verb = paused ? 'Paused' : 'Now playing';
  switch (source?.kind) {
    case 'mic':
      return 'Live · microphone';
    case 'tab':
      return 'Live · tab audio';
    case 'file':
      return `${verb} · ${source.name}`;
    case 'demo':
      return `${verb} · ${source.title}`;
    default:
      return 'Preview';
  }
}

export function Dock() {
  const source = useAppStore((state) => state.source);
  const phase = useAppStore((state) => state.phase);
  const paused = useAppStore((state) => state.paused);
  const song = useAppStore((state) => state.song);

  const status = phase === 'intro' ? 'Preview · muted' : describeSource(source, paused);

  return (
    <section className="dock chrome" aria-label="Audio source">
      <TransportBar>
        <SpectrumStrip />
        <p className="dock__status" aria-live="polite">
          {status}
        </p>
        <MusicDna />
      </TransportBar>
      {source && (
        <div className="song-row">
          {song ? <SongMap song={song} /> : <SongLearning />}
          <CastList />
        </div>
      )}
      <SourceBar />
    </section>
  );
}
