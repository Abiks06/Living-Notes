import { lazy, Suspense, useEffect, useState } from 'react';
import { startStayingAwake } from './lib/stayAwake';
import { useLibrary } from './library/library';
import { prepareAudio } from './state/actions';
import { useAppStore } from './state/appStore';
import { beginVisit } from './state/profile';
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
import { useRememberPlays } from './ui/useRememberPlays';
import { Greeting, NameCard } from './ui/Welcome';
import { useLibraryEdge } from './ui/useLibraryEdge';
import { useLibraryWatch } from './ui/useLibraryWatch';
import { useShortcuts } from './ui/useShortcuts';

// Fetched from the start, but only mounted once the page has painted: compiling shaders holds
// up the main thread, and the buttons should be usable before that begins.
const stageModule = import('./scene/Stage');
/** Long enough for the first screen to reach the display before the GPU gets busy. */
const STAGE_DELAY_MS = 150;
const Stage = lazy(() => stageModule.then((module) => ({ default: module.Stage })));

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
  useEffect(startStayingAwake, []);
  useEffect(beginVisit, []);
  useRememberPlays();
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setPainted(true), STAGE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  const chromeHidden = useChromeHidden();
  const studioOpen = useAppStore((state) => state.studioOpen);
  const libraryOpen = useLibrary((state) => state.open);
  const libraryPeek = useLibrary((state) => state.peek);
  const phase = useAppStore((state) => state.phase);

  useShortcuts();
  useLibraryWatch();
  useLibraryEdge();

  return (
    <main
      className="app"
      data-chrome={chromeHidden ? 'hidden' : 'visible'}
      data-phase={phase}
      data-library={libraryOpen ? 'open' : 'closed'}
    >
      {painted && (
        <Suspense fallback={null}>
          <Stage />
        </Suspense>
      )}
      <CaptureGuide />
      <header className="brand chrome" aria-hidden="true">
        <span className="brand__mark" />
        Resonance
      </header>
      <TitleCard />
      <Greeting />
      <NameCard />
      <StartOverlay />
      <InteractionHint />
      <PlayerBar />
      <TopActions />
      {studioOpen && (
        <Suspense fallback={null}>
          <StudioPanel />
        </Suspense>
      )}
      {(libraryOpen || libraryPeek !== 'off') && (
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
