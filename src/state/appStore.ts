import { isReturning } from './returning';
import { create } from 'zustand';
import type { Actor } from '../audio/cast';
import type { SongSummary } from '../audio/score/songMap';
import type { CaptureAspect, ClipLength } from '../recording/framing';
import { START_DPR, type ConcreteTier } from '../scene/particles/tiers';

export type Phase = 'intro' | 'running';

export type ActiveSource =
  | { kind: 'demo'; id: string; title: string }
  | { kind: 'file'; name: string; title?: string; artist?: string }
  | { kind: 'mic' }
  | { kind: 'tab'; title?: string; artist?: string };

/** What Windows says is playing, while system audio is listening to it. */
export interface LiveSong {
  /** Changes when the song does. */
  key: string;
  /** The session it's playing in, which controls are sent to. */
  id: string;
  /** Its title as reported, which tells apart two tabs of one browser. */
  reported: string;
  title: string;
  artist: string;
  album: string;
  art: string | null;
  playing: boolean;
  canToggle: boolean;
  canNext: boolean;
  canPrevious: boolean;
}

/** Sound coming from outside the app, which it can hear but not play, pause or skip. */
export function isLiveSource(source: ActiveSource | null): boolean {
  return source?.kind === 'mic' || source?.kind === 'tab';
}

export type MicStatus =
  'idle' | 'requesting' | 'live' | 'denied' | 'unsupported' | 'missing' | 'busy';

export type GpuStatus =
  | { state: 'pending' }
  | { state: 'ready'; precision: 'float' | 'half'; particles: number }
  | { state: 'lost' }
  | { state: 'unsupported'; reason: string };

export interface Notice {
  readonly id: number;
  readonly tone: 'error' | 'info';
  readonly title: string;
  readonly body: string;
}

interface AppState {
  phase: Phase;
  /** The visitor has orbited, zoomed or grabbed the scene at least once. */
  interacted: boolean;
  studioOpen: boolean;
  perfOverlay: boolean;
  /** H key: chrome stays hidden until H (or Esc) again. */
  uiHiddenManual: boolean;
  /** L key: everything hidden, and the backdrop turned up to light the room. */
  lounge: boolean;
  liveSong: LiveSong | null;
  recording: { state: 'idle' | 'recording'; elapsed: number; seconds: number };
  capture: { seconds: ClipLength; aspect: CaptureAspect };
  /** Camera distance multiplier while a narrow clip records. */
  captureFraming: number;
  source: ActiveSource | null;
  /** Label of the source currently loading, if any. */
  loading: string | null;
  mic: MicStatus;
  /** Chosen input; null is the system default. */
  micDevice: string | null;
  /** The current song's shape, once it's been learned. */
  song: SongSummary | null;
  learning: boolean;
  /** The one part left driving the picture, if any. */
  solo: Actor | null;
  gpu: GpuStatus;
  /** Bumped when the WebGL context is restored, so GPU resources are rebuilt. */
  gpuGeneration: number;
  /** Tier used when the particle setting is 'auto' (provisional until benchmarked). */
  autoTier: ConcreteTier | null;
  /** Ceiling on the render resolution, below the device's own ratio when the GPU needs it. */
  maxDpr: number;
  benchmark: {
    frameMs: number;
    stepMs: number;
    measuredAt: ConcreteTier;
    measuredDpr: number;
    dpr: number;
    picked: ConcreteTier;
  } | null;
  notice: Notice | null;
  paused: boolean;
  volume: number;
  muted: boolean;
  setPhase: (phase: Phase) => void;
  setInteracted: (interacted: boolean) => void;
  setStudioOpen: (open: boolean) => void;
  setPerfOverlay: (visible: boolean) => void;
  setUiHiddenManual: (hidden: boolean) => void;
  setRecording: (recording: AppState['recording']) => void;
  setCapture: (capture: Partial<AppState['capture']>) => void;
  setCaptureFraming: (captureFraming: number) => void;
  setSource: (source: ActiveSource | null) => void;
  setLiveSong: (song: LiveSong | null) => void;
  setLoading: (label: string | null) => void;
  setMic: (mic: MicStatus) => void;
  setMicDevice: (micDevice: string | null) => void;
  setSong: (song: SongSummary | null) => void;
  setLearning: (learning: boolean) => void;
  setSolo: (solo: Actor | null) => void;
  setGpu: (gpu: GpuStatus) => void;
  bumpGpuGeneration: () => void;
  setAutoTier: (tier: ConcreteTier) => void;
  setMaxDpr: (dpr: number) => void;
  setLounge: (lounge: boolean) => void;
  setBenchmark: (benchmark: AppState['benchmark']) => void;
  showNotice: (notice: Omit<Notice, 'id'>) => void;
  dismissNotice: () => void;
  setPaused: (paused: boolean) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
}

let noticeId = 0;

export const useAppStore = create<AppState>()((set) => ({
  // Someone who's brought music here before goes straight to it.
  phase: isReturning() ? 'running' : 'intro',
  interacted: false,
  studioOpen: false,
  perfOverlay: false,
  uiHiddenManual: false,
  lounge: false,
  liveSong: null,
  recording: { state: 'idle', elapsed: 0, seconds: 15 },
  capture: { seconds: 15, aspect: 'window' },
  captureFraming: 1,
  source: null,
  loading: null,
  mic: 'idle',
  micDevice: null,
  song: null,
  learning: false,
  solo: null,
  gpu: { state: 'pending' },
  gpuGeneration: 0,
  autoTier: null,
  maxDpr: START_DPR,
  benchmark: null,
  notice: null,
  paused: false,
  volume: 0.9,
  muted: false,
  setPhase: (phase) => set({ phase }),
  setInteracted: (interacted) => set({ interacted }),
  setStudioOpen: (studioOpen) => set({ studioOpen }),
  setPerfOverlay: (perfOverlay) => set({ perfOverlay }),
  setUiHiddenManual: (uiHiddenManual) => set({ uiHiddenManual }),
  setRecording: (recording) => set({ recording }),
  setCapture: (capture) => set((state) => ({ capture: { ...state.capture, ...capture } })),
  setCaptureFraming: (captureFraming) => set({ captureFraming }),
  setSource: (source) => set({ source }),
  setLiveSong: (liveSong) => set({ liveSong }),
  setLoading: (loading) => set({ loading }),
  setMic: (mic) => set({ mic }),
  setMicDevice: (micDevice) => set({ micDevice }),
  setSong: (song) => set({ song }),
  setLearning: (learning) => set({ learning }),
  setSolo: (solo) => set({ solo }),
  setGpu: (gpu) => set({ gpu }),
  bumpGpuGeneration: () => set((state) => ({ gpuGeneration: state.gpuGeneration + 1 })),
  setAutoTier: (autoTier) => set({ autoTier }),
  setMaxDpr: (maxDpr) => set({ maxDpr }),
  // Leaving also clears the "press L to come back" notice, which has done its job.
  setLounge: (lounge) =>
    set((state) => ({
      lounge,
      uiHiddenManual: lounge,
      notice: lounge ? state.notice : null,
    })),
  setBenchmark: (benchmark) => set({ benchmark }),
  showNotice: (notice) => set({ notice: { ...notice, id: ++noticeId } }),
  dismissNotice: () => set({ notice: null }),
  setPaused: (paused) => set({ paused }),
  setVolume: (volume) => set({ volume }),
  setMuted: (muted) => set({ muted }),
}));
