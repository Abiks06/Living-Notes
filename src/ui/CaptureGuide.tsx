import { aspectRatio } from '../recording/framing';
import { useAppStore } from '../state/appStore';

/** While a cropped clip records, dims what's outside the frame so you can see the shot. */
export function CaptureGuide() {
  const recording = useAppStore((state) => state.recording.state === 'recording');
  const aspect = useAppStore((state) => state.capture.aspect);
  if (!recording || aspect === 'window') return null;

  const ratio = aspectRatio(aspect, 1);
  return (
    <div
      className="capture-guide"
      style={{ width: `min(100vw, calc(100dvh * ${ratio}))`, aspectRatio: String(ratio) }}
      aria-hidden="true"
    />
  );
}
