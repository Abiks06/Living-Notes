import { lazy, Suspense, useEffect } from 'react';
import { useLibrary } from './library/library';
import { Stage } from './scene/Stage';
import { prepareAudio } from './state/actions';
import { useAppStore } from './state/appStore';
import { CaptureGuide } from './ui/CaptureGuide';
import { DropZone } from './ui/DropZone';
import { LoungeBadge } from './ui/LoungeBadge';
import { MicNotice } from './ui/MicNotice';
import { NoticeToast } from './ui/NoticeToast';
import { PerfOverlay } from './ui/PerfOverlay';
import { InteractionHint } from './ui/InteractionHint';
import { PlayerBar } from './ui/PlayerBar';
import { StartOverlay } from './ui/StartOverlay';
import { TitleCard } from './ui/TitleCard';
import { TopActions } from './ui/TopActions';
import { useChromeHidden } from './ui/useChromeHidden';
import { useShortcuts } from './ui/useShortcuts';

// Not needed for the first impression, so it loads the first time it's opened.
const StudioPanel = lazy(() =>
  import('./ui/studio/StudioDrawer').then((module) => ({ default: module.StudioPanel })),
);

// The same: nobody needs the library until they ask for it.
const LibraryPanel = lazy(() =>
  import('./ui/library/LibraryPanel').then((module) => ({ default: module.LibraryPanel })),
);

export function App() {
  useEffect(prepareAudio, []);
  const chromeHidden = useChromeHidden();
  const studioOpen = useAppStore((state) => state.studioOpen);
  const libraryOpen = useLibrary((state) => state.open);
  const phase = useAppStore((state) => state.phase);

  useShortcuts();

  return (
    <main
      className="app"
      data-chrome={chromeHidden ? 'hidden' : 'visible'}
      data-phase={phase}
      data-library={libraryOpen ? 'open' : 'closed'}
    >
      <Stage />
      <CaptureGuide />
      <header className="brand chrome" aria-hidden="true">
        <span className="brand__mark" />
        Resonance
      </header>
      <TitleCard />
      <StartOverlay />
      <InteractionHint />
      <PlayerBar />
      <TopActions />
      {studioOpen && (
        <Suspense fallback={null}>
          <StudioPanel />
        </Suspense>
      )}
      {libraryOpen && (
        <Suspense fallback={null}>
          <LibraryPanel />
        </Suspense>
      )}
      <PerfOverlay />
      <LoungeBadge />
      <MicNotice />
      <NoticeToast />
      <DropZone />
    </main>
  );
}
