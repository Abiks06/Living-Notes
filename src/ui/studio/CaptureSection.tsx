import { recordingSupport } from '../../recording/clipRecorder';
import {
  CAPTURE_ASPECTS,
  type CaptureAspect,
  CLIP_LENGTHS,
  type ClipLength,
} from '../../recording/framing';
import { takeSnapshot } from '../../recording/recordingActions';
import { useAppStore } from '../../state/appStore';
import { Section, Segmented } from './controls';

const LENGTHS = CLIP_LENGTHS.map((seconds) => ({ value: String(seconds), label: `${seconds}s` }));
const ASPECTS = CAPTURE_ASPECTS.map((aspect) => ({
  value: aspect,
  label: aspect === 'window' ? 'Window' : aspect,
}));

export function CaptureSection() {
  const capture = useAppStore((state) => state.capture);
  const setCapture = useAppStore((state) => state.setCapture);
  const busy = useAppStore((state) => state.recording.state === 'recording');
  const support = recordingSupport();

  return (
    <Section title="Capture">
      <Segmented<string>
        label="Clip length"
        options={LENGTHS}
        value={String(capture.seconds)}
        disabled={busy || !support.ok}
        onChange={(value) => setCapture({ seconds: Number(value) as ClipLength })}
      />
      <div className="studio-gap" />
      <Segmented<CaptureAspect>
        label="Frame"
        options={ASPECTS}
        value={capture.aspect}
        disabled={busy}
        onChange={(aspect) => setCapture({ aspect })}
      />
      <div className="studio-actions studio-actions--spaced">
        <button type="button" className="button" onClick={() => void takeSnapshot()}>
          Snapshot PNG
        </button>
      </div>
      <p className="studio-caption">
        {support.ok
          ? 'Vertical clips centre-crop the scene and pull the camera back while recording.'
          : `${support.reason} Snapshots still work.`}
      </p>
    </Section>
  );
}
