import { useLibrary } from '../library/library';
import { audioEngine } from '../audio/AudioEngine';
import { useSettings } from '../settings/settingsStore';
import { ensureStarted, startExperience } from '../state/actions';
import { useAppStore } from '../state/appStore';
import { type ClipRecording, downloadBlob, recordClip, recordingSupport } from './clipRecorder';
import { requestSnapshot, startComposite, stopComposite } from './compositor';
import { framingFactor } from './framing';
import { canRecordClip, TAB_RECORDING_REASON } from './recordable';

let stageCanvas: HTMLCanvasElement | null = null;
let active: ClipRecording | null = null;

// A clip of a local song ends where tab audio takes over; what came before it is still saved.
useAppStore.subscribe((state, previous) => {
  if (state.source !== previous.source && !canRecordClip(state.source)) active?.stop();
});

/** The WebGL canvas registers itself here when it's created. */
export function registerStageCanvas(canvas: HTMLCanvasElement | null): void {
  stageCanvas = canvas;
}

function formatSize(bytes: number): string {
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`;
}

function fileBase(): string {
  return `resonance-${useSettings.getState().scene}`;
}

export function startRecording(): void {
  const store = useAppStore.getState();
  if (active || store.recording.state !== 'idle') return;

  if (!canRecordClip(store.source)) {
    store.showNotice({
      tone: 'info',
      title: 'Recording isn’t available',
      body: `${TAB_RECORDING_REASON} Play a song from your library to record.`,
    });
    return;
  }

  const support = recordingSupport();
  if (!support.ok || !stageCanvas) {
    store.showNotice({
      tone: 'info',
      title: 'Recording isn’t available',
      body: support.ok
        ? 'The 3D scene isn’t running, so there is nothing to record.'
        : `${support.reason} Try a current Chrome, Edge, Firefox or Safari.`,
    });
    return;
  }

  // From the intro, the record button doubles as "start": the clip should have sound.
  if (store.phase === 'intro') startExperience();
  else ensureStarted();

  const { seconds, aspect } = store.capture;
  try {
    const windowRatio = stageCanvas.width / stageCanvas.height;
    store.setCaptureFraming(framingFactor(windowRatio, aspect));
    active = recordClip({
      // Straight from the stage where possible, as copying each frame has a cost.
      canvas:
        aspect === 'window' && !useLibrary.getState().nowPlaying
          ? stageCanvas
          : startComposite(stageCanvas, aspect),
      audio: audioEngine.recordingStream,
      seconds,
      onProgress: (elapsed) =>
        useAppStore.getState().setRecording({ state: 'recording', elapsed, seconds }),
    });
  } catch {
    stopComposite();
    store.setCaptureFraming(1);
    store.showNotice({
      tone: 'error',
      title: 'Couldn’t start recording',
      body: 'The browser refused to start the video encoder. Reload and try again.',
    });
    return;
  }
  store.setRecording({ state: 'recording', elapsed: 0, seconds });

  active.done
    .then((clip) => {
      // A canvas that never painted (tab hidden for the whole clip) yields an empty file.
      if (clip.blob.size === 0) {
        useAppStore.getState().showNotice({
          tone: 'error',
          title: 'Nothing was recorded',
          body: 'The page was in the background, so no frames were captured. Keep the tab visible while recording.',
        });
        return;
      }
      const name = downloadBlob(clip.blob, fileBase(), clip.format.extension);
      useAppStore.getState().showNotice({
        tone: 'info',
        title: 'Clip saved',
        body: `${name} · ${formatSize(clip.blob.size)}${clip.hasAudio ? '' : ' · no audio track in this browser'}`,
      });
    })
    .catch(() => {
      useAppStore.getState().showNotice({
        tone: 'error',
        title: 'Recording failed',
        body: 'The encoder stopped unexpectedly, so no file was saved. Try again.',
      });
    })
    .finally(() => {
      active = null;
      stopComposite();
      const state = useAppStore.getState();
      state.setCaptureFraming(1);
      state.setRecording({ state: 'idle', elapsed: 0, seconds });
    });
}

/** Ends early; whatever was recorded so far is still saved. */
export function stopRecording(): void {
  active?.stop();
}

export async function takeSnapshot(): Promise<void> {
  const store = useAppStore.getState();
  try {
    const blob = await requestSnapshot(store.capture.aspect);
    const name = downloadBlob(blob, fileBase(), 'png');
    store.showNotice({
      tone: 'info',
      title: 'Snapshot saved',
      body: `${name} · ${formatSize(blob.size)}`,
    });
  } catch {
    store.showNotice({
      tone: 'error',
      title: 'Couldn’t take a snapshot',
      body: 'No frame was available. Keep the tab visible and try again.',
    });
  }
}
