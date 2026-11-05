import { lazy, Suspense, useEffect } from 'react';
import { Stage } from './scene/Stage';
import { prepareAudio } from './state/actions';
import { useAppStore } from './state/appStore';
import { CaptureGuide } from './ui/CaptureGuide';
import { Dock } from './ui/Dock';
import { DropZone } from './ui/DropZone';
import { LoungeBadge } from './ui/LoungeBadge';
import { MicNotice } from './ui/MicNotice';
import { NoticeToast } from './ui/NoticeToast';
import { PerfOverlay } from './ui/PerfOverlay';
import { ScenePicker } from './ui/ScenePicker';
import { StartOverlay } from './ui/StartOverlay';
import { TopActions } from './ui/TopActions';
import { useChromeHidden } from './ui/useChromeHidden';

// Not needed for the first impression, so it loads the first time it's opened.
const StudioPanel = lazy(() =>
  import('./ui/studio/StudioDrawer').then((module) => ({ default: module.StudioPanel })),
);

export function App() {
  useEffect(prepareAudio, []);
  const chromeHidden = useChromeHidden();
  const studioOpen = useAppStore((state) => state.studioOpen);

  return (
    <main className="app" data-chrome={chromeHidden ? 'hidden' : 'visible'}>
      <Stage />
      <CaptureGuide />
      <header className="brand chrome" aria-hidden="true">
        <span className="brand__mark" />
        Resonance
      </header>
      <StartOverlay />
      <ScenePicker />
      <Dock />
      <TopActions />
      {studioOpen && (
        <Suspense fallback={null}>
          <StudioPanel />
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
