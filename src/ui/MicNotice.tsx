import { type MicStatus, useAppStore } from '../state/appStore';
import { backToDemo, enableMic } from '../state/actions';
import { MicIcon } from './icons';

const COPY: Partial<Record<MicStatus, { title: string; body: string; retry: boolean }>> = {
  denied: {
    title: 'Microphone access is blocked',
    body: 'Resonance only analyses sound on your device — nothing is recorded or uploaded. To allow it, click the lock or settings icon in the address bar, set Microphone to “Allow”, then try again.',
    retry: true,
  },
  missing: {
    title: 'No microphone found',
    body: 'Plug in or enable a microphone, then try again. Until then, the demo tracks and your own files work great.',
    retry: true,
  },
  busy: {
    title: 'Your microphone is busy',
    body: 'Another app may be holding it, often a call. Close that app or choose another input in Studio, then try again.',
    retry: true,
  },
  unsupported: {
    title: 'Microphone isn’t available here',
    body: 'This browser (or an insecure http:// page) doesn’t allow microphone input. Open the site over https in a current browser to use it.',
    retry: false,
  },
};

export function MicNotice() {
  const mic = useAppStore((state) => state.mic);
  const copy = COPY[mic];
  if (!copy) return null;

  return (
    <div
      className="mic-notice"
      role="alertdialog"
      aria-labelledby="mic-title"
      aria-describedby="mic-body"
    >
      <div className="mic-notice__icon">
        <MicIcon width={22} height={22} />
      </div>
      <h2 id="mic-title">{copy.title}</h2>
      <p id="mic-body">{copy.body}</p>
      <div className="mic-notice__actions">
        {copy.retry && (
          <button type="button" className="button button--primary" onClick={() => void enableMic()}>
            Try again
          </button>
        )}
        <button type="button" className="button" onClick={backToDemo} autoFocus={!copy.retry}>
          Back to demo
        </button>
      </div>
    </div>
  );
}
